import { open, watch } from "node:fs/promises";
import { defineCommand } from "citty";
import { rejectUnknownArgs } from "../args.ts";
import { getLogPath, type LogEntry, readLogEntries } from "../log.ts";

function formatEntry(entry: LogEntry): string {
	const time = entry.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
	const cwd = entry.cwd;
	const tool = entry.tool_name;
	const decision = entry.decision.toUpperCase();
	const provider = entry.provider ?? "-";
	const duration = `${entry.duration_ms}ms`;

	// Extract the most useful bit from tool_input
	const input =
		typeof entry.tool_input.command === "string"
			? entry.tool_input.command
			: typeof entry.tool_input.file_path === "string"
				? entry.tool_input.file_path
				: JSON.stringify(entry.tool_input);

	return `${time}  ${decision.padEnd(7)}  ${cwd.padEnd(30)}  ${tool.padEnd(10)}  ${provider.padEnd(18)}  ${duration.padStart(6)}  ${input}`;
}

const HEADER = `${"TIME".padEnd(21)}  ${"DECIDE".padEnd(7)}  ${"CWD".padEnd(30)}  ${"TOOL".padEnd(10)}  ${"PROVIDER".padEnd(18)}  ${"DUR".padStart(6)}  INPUT`;

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
		const follow = args.follow ?? false;

		const entries = await readLogEntries(last);

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
			await tailLog(getLogPath(), jsonMode);
		}
	},
});

async function tailLog(logPath: string, jsonMode: boolean): Promise<void> {
	// Open the file and seek to end
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(logPath, "r");
	} catch {
		// File doesn't exist yet, wait for it
		handle = await open(logPath, "a+");
	}
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
			if (jsonMode) {
				console.log(line);
			} else {
				try {
					console.log(formatEntry(JSON.parse(line)));
				} catch {
					// skip malformed lines
				}
			}
		}
	}

	await handle.close();
}
