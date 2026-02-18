import { homedir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";
import {
	extractBashPatterns,
	matchPattern,
	settingsPaths,
} from "../agents/claude.ts";
import { rejectUnknownArgs } from "../args.ts";
import { closeDb, getDb } from "../db.ts";
import { readSettings, writeSettings } from "../install.ts";

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

/** Query frequently-allowed commands and filter out those already in allow lists. */
export function getSuggestions(
	minCount: number,
	allowPatterns: string[],
): Suggestion[] {
	const db = getDb();

	const rows = db
		.query(
			`SELECT tool_input, COUNT(*) as count
			 FROM logs
			 WHERE decision = 'allow' AND mode IS NULL AND tool_name = 'Bash'
			 GROUP BY tool_input
			 HAVING COUNT(*) >= ?
			 ORDER BY COUNT(*) DESC`,
		)
		.all(minCount) as CommandFrequency[];

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

			const suggestions = getSuggestions(minCount, allowPatterns);

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
