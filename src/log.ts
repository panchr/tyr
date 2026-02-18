import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import { getDb } from "./db.ts";

// -- Legacy JSONL schema (used only for migration) --

const LegacyLogEntrySchema = z.object({
	timestamp: z.string(),
	cwd: z.string(),
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()),
	decision: z.enum(["allow", "deny", "abstain", "error"]),
	provider: z.string().nullable(),
	duration_ms: z.number(),
	session_id: z.string(),
	mode: z.enum(["shadow", "audit"]).optional(),
	llm_prompt: z.string().optional(),
	llm_model: z.string().optional(),
	llm_timeout: z.number().optional(),
	llm_endpoint: z.string().optional(),
});

// -- SQLite log entry type --

export interface LogEntry {
	timestamp: number;
	session_id: string;
	cwd: string;
	tool_name: string;
	tool_input: string;
	input: string;
	decision: "allow" | "deny" | "abstain" | "error";
	provider: string | null;
	reason?: string | null;
	duration_ms: number;
	cached?: number;
	mode?: "shadow" | "audit" | null;
}

export interface LlmLogEntry {
	prompt: string;
	model: string;
}

/** Extract a human-readable tool_input string from the raw PermissionRequest tool_input. */
export function extractToolInput(
	toolName: string,
	toolInput: Record<string, unknown>,
): string {
	if (toolName === "Bash" && typeof toolInput.command === "string") {
		return toolInput.command;
	}
	return JSON.stringify(toolInput);
}

export function appendLogEntry(entry: LogEntry, llm?: LlmLogEntry): void {
	const db = getDb();
	const result = db
		.query(
			`INSERT INTO logs (timestamp, session_id, cwd, tool_name, tool_input, input, decision, provider, reason, duration_ms, cached, mode)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			entry.timestamp,
			entry.session_id,
			entry.cwd,
			entry.tool_name,
			entry.tool_input,
			entry.input,
			entry.decision,
			entry.provider,
			entry.reason ?? null,
			entry.duration_ms,
			entry.cached ?? 0,
			entry.mode ?? null,
		);

	if (llm) {
		const logId = Number(result.lastInsertRowid);
		db.query(
			"INSERT INTO llm_logs (log_id, prompt, model) VALUES (?, ?, ?)",
		).run(logId, llm.prompt, llm.model);
	}
}

export interface LogRow {
	id: number;
	timestamp: number;
	session_id: string;
	cwd: string;
	tool_name: string;
	tool_input: string;
	input: string;
	decision: string;
	provider: string | null;
	reason: string | null;
	duration_ms: number;
	cached: number;
	mode: string | null;
}

export interface ReadLogOptions {
	last?: number;
	since?: number;
	until?: number;
	decision?: string;
	provider?: string;
	cwd?: string;
}

export function readLogEntries(opts: ReadLogOptions = {}): LogRow[] {
	const db = getDb();
	const conditions: string[] = [];
	const params: (string | number)[] = [];

	if (opts.since !== undefined) {
		conditions.push("timestamp >= ?");
		params.push(opts.since);
	}
	if (opts.until !== undefined) {
		conditions.push("timestamp <= ?");
		params.push(opts.until);
	}
	if (opts.decision !== undefined) {
		conditions.push("decision = ?");
		params.push(opts.decision);
	}
	if (opts.provider !== undefined) {
		conditions.push("provider = ?");
		params.push(opts.provider);
	}
	if (opts.cwd !== undefined) {
		const escapedCwd = opts.cwd.replace(/[%_]/g, "\\$&");
		conditions.push("(cwd = ? OR cwd LIKE ? || '/%' ESCAPE '\\')");
		params.push(opts.cwd, escapedCwd);
	}

	const where =
		conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit =
		opts.last !== undefined && opts.last > 0 ? `LIMIT ${opts.last}` : "";

	// Use a subquery to get the last N rows (ordered by id DESC), then re-order ASC
	const sql = limit
		? `SELECT * FROM (SELECT * FROM logs ${where} ORDER BY id DESC ${limit}) ORDER BY id ASC`
		: `SELECT * FROM logs ${where} ORDER BY id ASC`;

	return db.query(sql).all(...params) as LogRow[];
}

// -- JSONL migration --

const DEFAULT_LOG_DIR = join(homedir(), ".local", "share", "tyr");
const DEFAULT_LOG_FILE = join(DEFAULT_LOG_DIR, "log.jsonl");

function getLegacyLogPath(): string {
	return process.env.TYR_LOG_FILE ?? DEFAULT_LOG_FILE;
}

/** Import existing JSONL log entries into SQLite, then delete the file. */
export function migrateJsonlToSqlite(verbose = false): void {
	const logFile = getLegacyLogPath();
	if (!existsSync(logFile)) return;

	let text: string;
	try {
		text = readFileSync(logFile, "utf-8");
	} catch {
		return;
	}

	const lines = text.trim().split("\n").filter(Boolean);
	if (lines.length === 0) {
		unlinkSync(logFile);
		return;
	}

	const db = getDb();
	let imported = 0;
	let skipped = 0;

	const insertLog = db.query(
		`INSERT INTO logs (timestamp, session_id, cwd, tool_name, tool_input, input, decision, provider, duration_ms, mode)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	const insertLlm = db.query(
		"INSERT INTO llm_logs (log_id, prompt, model) VALUES (?, ?, ?)",
	);

	db.transaction(() => {
		for (const line of lines) {
			try {
				const raw = JSON.parse(line);
				const parsed = LegacyLogEntrySchema.safeParse(raw);
				if (!parsed.success) {
					skipped++;
					continue;
				}
				const e = parsed.data;
				const ts = new Date(e.timestamp).getTime();
				if (Number.isNaN(ts)) {
					skipped++;
					continue;
				}

				const toolInput = extractToolInput(e.tool_name, e.tool_input);

				const result = insertLog.run(
					ts,
					e.session_id,
					e.cwd,
					e.tool_name,
					toolInput,
					JSON.stringify(e.tool_input),
					e.decision,
					e.provider,
					e.duration_ms,
					e.mode ?? null,
				);

				if (e.llm_prompt && e.llm_model) {
					insertLlm.run(
						Number(result.lastInsertRowid),
						e.llm_prompt,
						e.llm_model,
					);
				}

				imported++;
			} catch {
				skipped++;
			}
		}
	})();

	if (verbose) {
		console.error(
			`[tyr] migrated ${imported} log entries from JSONL (${skipped} skipped)`,
		);
	}

	if (imported === 0 && skipped > 0) {
		if (verbose) {
			console.error(
				"[tyr] no entries imported from JSONL — keeping file for manual review",
			);
		}
		return;
	}

	unlinkSync(logFile);
}
