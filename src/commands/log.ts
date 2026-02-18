import { defineCommand } from "citty";
import { parseTime, rejectUnknownArgs } from "../args.ts";
import { closeDb } from "../db.ts";
import { type LogRow, readLogEntries } from "../log.ts";

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

export default defineCommand({
	meta: {
		name: "log",
		description: "View permission check history",
	},
	args: logArgs,
	async run({ args, rawArgs }) {
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

		const entries = readLogEntries({
			last: last > 0 ? last : undefined,
			since,
			until,
			decision: args.decision,
			provider: args.provider,
			cwd: args.cwd,
		});

		if (jsonMode) {
			for (const entry of entries) {
				console.log(JSON.stringify(entry));
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
			}
		}

		closeDb();
	},
});
