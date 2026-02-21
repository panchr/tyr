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
import { readSettings } from "../install.ts";
import { getRepoRoot } from "../repo.ts";

const suggestArgs = {
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

function buildSuggestSystemPrompt(
	suggestions: Suggestion[],
	settingsPath: string,
): string {
	const commandList = suggestions
		.map((s) => `- \`${s.command}\` (approved ${s.count} times)`)
		.join("\n");

	return `You are helping configure permission rules for Claude Code.

The user has been manually approving shell commands while using Claude Code. Tyr has identified frequently-approved commands that could be added as permanent allow rules.

## Frequently Approved Commands (not yet in allow rules)

${commandList}

## Settings File
- Path: ${settingsPath}
- Format: JSON with a \`permissions.allow\` array of strings
- Each rule is a string like \`Bash(pattern)\` where \`pattern\` can use \`*\` as a glob wildcard
- Example: \`Bash(bun *)\` allows any command starting with \`bun \`

## Your Task
Help the user decide which commands to add as allow rules:
1. Suggest generalized glob patterns that group similar commands (e.g., "bun test" and "bun lint" → "Bash(bun *)")
2. Explain what each pattern would match
3. When the user is ready, write the rules to the settings file at the path above

Be concise. Start by presenting your suggested rules and ask if the user wants to adjust them.`;
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

		const repoRoot = getRepoRoot();
		const allPaths = settingsPaths(repoRoot);
		const allowPatterns: string[] = [];
		for (const path of allPaths) {
			const settings = await readSettings(path);
			const perms = settings.permissions as Record<string, unknown> | undefined;
			if (perms && Array.isArray(perms.allow)) {
				allowPatterns.push(...extractBashPatterns(perms.allow));
			}
		}

		const cwdFilter = args.all ? undefined : repoRoot;
		const suggestions = getSuggestions(minCount, allowPatterns, cwdFilter);
		closeDb();

		if (suggestions.length === 0) {
			console.log("No new suggestions found.");
			return;
		}

		const scope: "global" | "project" = args.project ? "project" : "global";
		const configDir =
			process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
		const settingsPath =
			scope === "global"
				? join(configDir, "settings.json")
				: join(repoRoot, ".claude", "settings.json");

		const systemPrompt = buildSuggestSystemPrompt(suggestions, settingsPath);

		const proc = Bun.spawn(
			[
				"claude",
				"--append-system-prompt",
				systemPrompt,
				"Review the suggested permission rules and help me decide which to add.",
			],
			{
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
				env: { ...process.env, CLAUDECODE: undefined },
			},
		);

		process.exitCode = await proc.exited;
	},
});
