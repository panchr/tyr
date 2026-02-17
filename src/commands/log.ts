import { open, watch } from "node:fs/promises";
import { defineCommand } from "citty";
import { rejectUnknownArgs } from "../args.ts";
import { getLogPath, type LogEntry, readLogEntries } from "../log.ts";

function formatEntry(entry: LogEntry): string {
	const time = entry.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
	const decision = entry.decision.toUpperCase();
	const project = entry.cwd ?? "-";
	const tool = entry.tool_name;
	const provider = entry.provider ?? "-";
	const duration = `${entry.duration_ms}ms`;

	// Extract the most useful bit from tool_input
	const input =
		typeof entry.tool_input.command === "string"
			? entry.tool_input.command
			: typeof entry.tool_input.file_path === "string"
				? entry.tool_input.file_path
				: JSON.stringify(entry.tool_input);

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
	follow: {
		type: "boolean" as const,
		alias: "f",
		description: "Tail the log",
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

interface LogFilter {
	since?: Date;
	until?: Date;
	decision?: string;
	provider?: string;
	cwd?: string;
}

/** Parse a relative time string like '1h', '30m', '2d' into a Date, or parse ISO. */
function parseTime(value: string): Date | null {
	const relativeMatch = value.match(/^(\d+)([smhd])$/);
	if (relativeMatch) {
		const amount = Number(relativeMatch[1]);
		const unit = relativeMatch[2];
		const multipliers: Record<string, number> = {
			s: 1000,
			m: 60_000,
			h: 3_600_000,
			d: 86_400_000,
		};
		const ms = multipliers[unit as string];
		if (ms === undefined) return null;
		return new Date(Date.now() - amount * ms);
	}
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
	if (filter.since && new Date(entry.timestamp) < filter.since) return false;
	if (filter.until && new Date(entry.timestamp) > filter.until) return false;
	if (filter.decision && entry.decision !== filter.decision) return false;
	if (filter.provider && entry.provider !== filter.provider) return false;
	if (
		filter.cwd &&
		entry.cwd !== filter.cwd &&
		!entry.cwd.startsWith(`${filter.cwd}/`)
	)
		return false;
	return true;
}

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
		const follow = args.follow ?? false;

		const filter: LogFilter = {};
		if (args.since) {
			const t = parseTime(args.since);
			if (!t) {
				console.error(`Invalid --since value: ${args.since}`);
				process.exit(1);
				return;
			}
			filter.since = t;
		}
		if (args.until) {
			const t = parseTime(args.until);
			if (!t) {
				console.error(`Invalid --until value: ${args.until}`);
				process.exit(1);
				return;
			}
			filter.until = t;
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
			filter.decision = args.decision;
		}
		if (args.provider) filter.provider = args.provider;
		if (args.cwd) filter.cwd = args.cwd;

		const hasFilter = Object.keys(filter).length > 0;

		// Read all entries when filtering, apply --last after filtering
		const allEntries = await readLogEntries(hasFilter ? undefined : last);
		const filtered = hasFilter
			? allEntries.filter((e) => matchesFilter(e, filter))
			: allEntries;
		const entries = last > 0 ? filtered.slice(-last) : filtered;

		if (jsonMode) {
			for (const entry of entries) {
				console.log(JSON.stringify(entry));
			}
		} else {
			if (entries.length === 0 && !follow) {
				console.log("No log entries yet.");
				return;
			}
			console.log(HEADER);
			for (const entry of entries) {
				console.log(formatEntry(entry));
			}
		}

		if (follow) {
			await tailLog(getLogPath(), jsonMode, hasFilter ? filter : undefined);
		}
	},
});

async function tailLog(
	logPath: string,
	jsonMode: boolean,
	filter?: LogFilter,
): Promise<void> {
	// Open the file and seek to end
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(logPath, "r");
	} catch {
		// File doesn't exist yet, wait for it
		handle = await open(logPath, "a+");
	}

	try {
		const stat = await handle.stat();
		let offset = stat.size;

		const watcher = watch(logPath);
		for await (const _event of watcher) {
			const newStat = await handle.stat();
			if (newStat.size <= offset) continue;

			const buf = Buffer.alloc(newStat.size - offset);
			await handle.read(buf, 0, buf.length, offset);
			offset = newStat.size;

			const lines = buf.toString("utf-8").trim().split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const entry = JSON.parse(line) as LogEntry;
					if (filter && !matchesFilter(entry, filter)) continue;
					if (jsonMode) {
						console.log(line);
					} else {
						console.log(formatEntry(entry));
					}
				} catch {
					// skip malformed lines
				}
			}
		}
	} finally {
		await handle.close();
	}
}
