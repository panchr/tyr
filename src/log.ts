import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PermissionResult } from "./types.ts";

export interface LogEntry {
	timestamp: string;
	cwd: string;
	tool_name: string;
	tool_input: Record<string, unknown>;
	decision: PermissionResult | "error";
	provider: string | null;
	duration_ms: number;
	session_id: string;
}

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
	const entries = lines.map((line) => JSON.parse(line) as LogEntry);

	if (last !== undefined && last > 0) {
		return entries.slice(-last);
	}
	return entries;
}
