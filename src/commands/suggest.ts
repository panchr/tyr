import { homedir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";
import {
	extractBashPatterns,
	matchPattern,
	settingsPaths,
} from "../agents/claude.ts";
import { rejectUnknownArgs } from "../args.ts";
import { readConfig } from "../config.ts";
import { closeDb, getDb } from "../db.ts";
import { readSettings, writeSettings } from "../install.ts";
import { buildGeneralizePrompt, parseGeneralizeResponse } from "../prompts.ts";

const suggestArgs = {
	apply: {
		type: "boolean" as const,
		description: "Write suggestions into Claude's settings.json",
	},
	global: {
		type: "boolean" as const,
		description: "Target global (~/.claude/settings.json)",
	},
	project: {
		type: "boolean" as const,
		description: "Target project (./.claude/settings.json)",
	},
	"min-count": {
		type: "string" as const,
		description: "Minimum approval count to suggest (default: 5)",
	},
	json: {
		type: "boolean" as const,
		description: "Output raw JSON",
	},
	"no-generalize": {
		type: "boolean" as const,
		description: "Skip LLM generalization of suggestions",
	},
	all: {
		type: "boolean" as const,
		description:
			"Include commands from all projects (default: current directory)",
	},
};

interface CommandFrequency {
	tool_input: string;
	count: number;
}

export interface Suggestion {
	command: string;
	count: number;
	rule: string;
}

/** Query frequently-allowed commands and filter out those already in allow lists.
 *  When `cwd` is provided, only includes commands from that directory (or subdirs). */
export function getSuggestions(
	minCount: number,
	allowPatterns: string[],
	cwd?: string,
): Suggestion[] {
	const db = getDb();

	let query: string;
	let params: (number | string)[];

	if (cwd) {
		const escapedCwd = cwd.replace(/[%_]/g, "\\$&");
		query = `SELECT tool_input, COUNT(*) as count
			 FROM logs
			 WHERE decision = 'allow' AND mode IS NULL AND tool_name = 'Bash'
			   AND (cwd = ? OR cwd LIKE ? || '/%' ESCAPE '\\')
			 GROUP BY tool_input
			 HAVING COUNT(*) >= ?
			 ORDER BY COUNT(*) DESC`;
		params = [cwd, escapedCwd, minCount];
	} else {
		query = `SELECT tool_input, COUNT(*) as count
			 FROM logs
			 WHERE decision = 'allow' AND mode IS NULL AND tool_name = 'Bash'
			 GROUP BY tool_input
			 HAVING COUNT(*) >= ?
			 ORDER BY COUNT(*) DESC`;
		params = [minCount];
	}

	const rows = db.query(query).all(...params) as CommandFrequency[];

	const suggestions: Suggestion[] = [];
	for (const row of rows) {
		const alreadyAllowed = allowPatterns.some((p) =>
			matchPattern(p, row.tool_input),
		);
		if (!alreadyAllowed) {
			suggestions.push({
				command: row.tool_input,
				count: row.count,
				rule: `Bash(${row.tool_input})`,
			});
		}
	}

	return suggestions;
}

const GENERALIZE_TIMEOUT_MS = 30_000;

/** Use an LLM to generalize raw suggestions into broader glob patterns.
 *  Falls back to the original suggestions on any error. */
export async function generalizeSuggestions(
	suggestions: Suggestion[],
	model: string,
): Promise<Suggestion[]> {
	if (suggestions.length === 0) return suggestions;

	const prompt = buildGeneralizePrompt(
		suggestions.map((s) => ({ command: s.command, count: s.count })),
	);

	const env: Record<string, string | undefined> = {
		...process.env,
		CLAUDECODE: undefined,
	};

	const proc = Bun.spawn(
		[
			"claude",
			"-p",
			"--output-format",
			"text",
			"--no-session-persistence",
			"--model",
			model,
		],
		{
			stdin: new Response(prompt).body,
			stdout: "pipe",
			stderr: "pipe",
			env,
		},
	);

	let timer: Timer | undefined;
	const result = await Promise.race([
		(async () => {
			const [stdout] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);
			const exitCode = await proc.exited;
			return { stdout, exitCode, timedOut: false };
		})(),
		new Promise<{ stdout: string; exitCode: number; timedOut: boolean }>(
			(resolve) => {
				timer = setTimeout(() => {
					proc.kill();
					resolve({ stdout: "", exitCode: -1, timedOut: true });
				}, GENERALIZE_TIMEOUT_MS);
			},
		),
	]);
	clearTimeout(timer);

	if (result.timedOut || result.exitCode !== 0) return suggestions;

	const generalized = parseGeneralizeResponse(result.stdout);
	if (!generalized) return suggestions;

	return generalized
		.map((g) => ({
			command: g.pattern,
			count: g.count,
			rule: `Bash(${g.pattern})`,
		}))
		.sort((a, b) => b.count - a.count);
}

/** Merge new allow rules into existing settings without clobbering. */
export function mergeAllowRules(
	settings: Record<string, unknown>,
	rules: string[],
): Record<string, unknown> {
	const result = { ...settings };
	const perms = (result.permissions ?? {}) as Record<string, unknown>;
	const existing = Array.isArray(perms.allow) ? (perms.allow as string[]) : [];

	const existingSet = new Set(existing);
	const merged = [...existing, ...rules.filter((r) => !existingSet.has(r))];

	result.permissions = { ...perms, allow: merged };
	return result;
}

export default defineCommand({
	meta: {
		name: "suggest",
		description:
			"Suggest permissions to add to Claude settings based on decision history",
	},
	args: suggestArgs,
	async run({ args, rawArgs }) {
		rejectUnknownArgs(rawArgs, suggestArgs);

		if (args.global && args.project) {
			console.error("Cannot specify both --global and --project");
			process.exit(1);
			return;
		}

		const minCount = args["min-count"] ? Number(args["min-count"]) : 5;
		if (!Number.isFinite(minCount) || minCount < 1) {
			console.error(`Invalid --min-count value: ${args["min-count"]}`);
			process.exit(1);
			return;
		}

		try {
			// Load all allow patterns from Claude settings to filter suggestions
			const allPaths = settingsPaths(process.cwd());
			const allowPatterns: string[] = [];
			for (const path of allPaths) {
				const settings = await readSettings(path);
				const perms = settings.permissions as
					| Record<string, unknown>
					| undefined;
				if (perms && Array.isArray(perms.allow)) {
					allowPatterns.push(...extractBashPatterns(perms.allow));
				}
			}

			const cwdFilter = args.all ? undefined : process.cwd();
			const rawSuggestions = getSuggestions(minCount, allowPatterns, cwdFilter);

			let suggestions = rawSuggestions;
			if (!args["no-generalize"] && rawSuggestions.length > 0) {
				let model = "haiku";
				try {
					const config = await readConfig();
					model = config.claude.model;
				} catch {
					// use default model
				}
				try {
					suggestions = await generalizeSuggestions(rawSuggestions, model);
				} catch {
					// fall back to raw suggestions
				}
			}

			if (args.json) {
				console.log(JSON.stringify(suggestions));
				return;
			}

			if (suggestions.length === 0) {
				console.log("No new suggestions found.");
				return;
			}

			if (!args.apply) {
				console.log(
					`Suggested allow rules (commands approved >= ${minCount} times):`,
				);
				console.log();
				for (const s of suggestions) {
					console.log(`  ${s.rule}  (${s.count} approvals)`);
				}
				console.log();
				console.log("Run with --apply to add these rules to Claude settings.");
				return;
			}

			// Apply mode: write rules to settings
			const scope: "global" | "project" = args.project ? "project" : "global";
			const configDir =
				process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
			const settingsPath =
				scope === "global"
					? join(configDir, "settings.json")
					: join(process.cwd(), ".claude", "settings.json");
			const settings = await readSettings(settingsPath);

			const newRules = suggestions.map((s) => s.rule);
			const merged = mergeAllowRules(settings, newRules);
			await writeSettings(settingsPath, merged);

			console.log(
				`Added ${newRules.length} allow rule(s) to ${scope} settings (${settingsPath}):`,
			);
			for (const rule of newRules) {
				console.log(`  ${rule}`);
			}
		} finally {
			closeDb();
		}
	},
});
