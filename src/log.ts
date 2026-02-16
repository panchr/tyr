import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod/v4";

export const LogEntrySchema = z.object({
	timestamp: z.string(),
	cwd: z.string(),
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()),
	decision: z.enum(["allow", "deny", "abstain", "error"]),
	provider: z.string().nullable(),
	duration_ms: z.number(),
	session_id: z.string(),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;

const DEFAULT_LOG_DIR = join(homedir(), ".local", "share", "tyr");
const DEFAULT_LOG_FILE = join(DEFAULT_LOG_DIR, "log.jsonl");

export function getLogPath(): string {
	return process.env.TYR_LOG_FILE ?? DEFAULT_LOG_FILE;
}

export async function appendLogEntry(entry: LogEntry): Promise<void> {
	const logFile = getLogPath();
	await mkdir(dirname(logFile), { recursive: true });
	const line = `${JSON.stringify(entry)}\n`;
	await appendFile(logFile, line, "utf-8");
}

export async function readLogEntries(last?: number): Promise<LogEntry[]> {
	const file = Bun.file(getLogPath());
	if (!(await file.exists())) return [];

	const text = await file.text();
	const lines = text.trim().split("\n").filter(Boolean);
	const entries: LogEntry[] = [];
	for (const line of lines) {
		try {
			const parsed = LogEntrySchema.safeParse(JSON.parse(line));
			if (parsed.success) {
				entries.push(parsed.data);
			}
		} catch {
			// Skip malformed JSON lines (truncated writes, corruption)
		}
	}

	if (last !== undefined && last > 0) {
		return entries.slice(-last);
	}
	return entries;
}
