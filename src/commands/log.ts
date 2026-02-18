import { defineCommand } from "citty";
import { parseTime, rejectUnknownArgs } from "../args.ts";
import { readConfig } from "../config.ts";
import { closeDb } from "../db.ts";
import {
	clearLogs,
	type LlmLogRow,
	type LogRow,
	readLlmLogs,
	readLogEntries,
	truncateOldLogs,
} from "../log.ts";

function formatTime(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	const y = d.getFullYear();
	const mo = pad(d.getMonth() + 1);
	const da = pad(d.getDate());
	const h = pad(d.getHours());
	const mi = pad(d.getMinutes());
	const se = pad(d.getSeconds());
	return `${y}-${mo}-${da} ${h}:${mi}:${se}`;
}

function formatEntry(entry: LogRow): string {
	const time = formatTime(entry.timestamp);
	const decision = entry.decision.toUpperCase();
	const project = entry.cwd ?? "-";
	const tool = entry.tool_name;
	const provider = entry.provider ?? "-";
	const duration = `${entry.duration_ms}ms`;

	const input = entry.tool_input;
	const maxInputLen = 80;
	const truncatedInput =
		input.length > maxInputLen ? `${input.slice(0, maxInputLen - 1)}…` : input;

	return `${time}  ${decision.padEnd(10)}  ${project.padEnd(30)}  ${tool.padEnd(10)}  ${provider.padEnd(18)}  ${duration.padStart(6)}  ${truncatedInput}`;
}

const HEADER = `${"TIME".padEnd(21)}  ${"DECISION".padEnd(10)}  ${"PROJECT".padEnd(30)}  ${"TOOL".padEnd(10)}  ${"PROVIDER".padEnd(18)}  ${"DUR".padStart(6)}  INPUT`;

const logArgs = {
	last: {
		type: "string" as const,
		description: "Show last N entries (default: 20)",
	},
	verbose: {
		type: "boolean" as const,
		description: "Show LLM prompt and model for entries with verbose logs",
	},
	json: {
		type: "boolean" as const,
		description: "Raw JSON output",
	},
	since: {
		type: "string" as const,
		description: "Show entries after timestamp (ISO or relative: 1h, 30m, 2d)",
	},
	until: {
		type: "string" as const,
		description: "Show entries before timestamp (ISO or relative: 1h, 30m, 2d)",
	},
	decision: {
		type: "string" as const,
		description: "Filter by decision (allow, deny, abstain, error)",
	},
	provider: {
		type: "string" as const,
		description: "Filter by provider name",
	},
	cwd: {
		type: "string" as const,
		description: "Filter by cwd path prefix",
	},
};

function handleClear(): void {
	const deleted = clearLogs();
	console.log(`Cleared ${deleted} log entries.`);
	closeDb();
}

export default defineCommand({
	meta: {
		name: "log",
		description:
			"View permission check history (use 'tyr log clear' to truncate)",
	},
	args: logArgs,
	async run({ args, rawArgs }) {
		// Handle "tyr log clear" subcommand
		if (rawArgs.includes("clear")) {
			handleClear();
			return;
		}

		rejectUnknownArgs(rawArgs, logArgs);
		const last = args.last ? Number.parseInt(args.last, 10) : 20;
		const jsonMode = args.json ?? false;

		let since: number | undefined;
		let until: number | undefined;

		if (args.since) {
			const t = parseTime(args.since);
			if (!t) {
				console.error(`Invalid --since value: ${args.since}`);
				process.exit(1);
				return;
			}
			since = t.getTime();
		}
		if (args.until) {
			const t = parseTime(args.until);
			if (!t) {
				console.error(`Invalid --until value: ${args.until}`);
				process.exit(1);
				return;
			}
			until = t.getTime();
		}
		if (args.decision) {
			const valid = ["allow", "deny", "abstain", "error"];
			if (!valid.includes(args.decision)) {
				console.error(
					`Invalid --decision value: ${args.decision}. Must be one of: ${valid.join(", ")}`,
				);
				process.exit(1);
				return;
			}
		}

		// Prune old log entries based on retention setting
		try {
			const config = await readConfig();
			truncateOldLogs(config.logRetention);
		} catch {
			// Best-effort: don't fail if config is unreadable
		}

		const entries = readLogEntries({
			last: last > 0 ? last : undefined,
			since,
			until,
			decision: args.decision,
			provider: args.provider,
			cwd: args.cwd,
		});

		const verboseMode = args.verbose ?? false;

		const llmLogs = verboseMode
			? readLlmLogs(entries.map((e) => e.id))
			: new Map<number, LlmLogRow>();

		if (jsonMode) {
			for (const entry of entries) {
				const llmRow = llmLogs.get(entry.id);
				if (llmRow) {
					const { log_id: _, ...llm } = llmRow;
					console.log(JSON.stringify({ ...entry, llm }));
				} else {
					console.log(JSON.stringify(entry));
				}
			}
		} else {
			if (entries.length === 0) {
				console.log("No log entries yet.");
				closeDb();
				return;
			}
			console.log(HEADER);
			for (const entry of entries) {
				console.log(formatEntry(entry));
				if (verboseMode) {
					const llm = llmLogs.get(entry.id);
					if (llm) {
						console.log(`  model: ${llm.model}`);
						console.log(`  prompt: ${llm.prompt}`);
					}
				}
			}
		}

		closeDb();
	},
});
