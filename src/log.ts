import { getDb } from "./db.ts";

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
