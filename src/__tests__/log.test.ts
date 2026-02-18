import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbInstance } from "../db.ts";
import {
	appendLogEntry,
	clearLogs,
	type LogEntry,
	type LogRow,
	parseRetention,
	readLogEntries,
	truncateOldLogs,
} from "../log.ts";
import { saveEnv } from "./helpers/index.ts";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: Date.now(),
		cwd: "/test/dir",
		tool_name: "Bash",
		tool_input: "echo hello",
		input: '{"command":"echo hello"}',
		decision: "abstain",
		provider: null,
		duration_ms: 5,
		session_id: "test-session",
		...overrides,
	};
}

let tempDir: string;
const restoreDbEnv = saveEnv("TYR_DB_PATH");
const restoreConfigEnv = saveEnv("TYR_CONFIG_FILE");
afterEach(async () => {
	resetDbInstance();
	restoreDbEnv();
	restoreConfigEnv();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = "";
	}
});

async function setupTempDb(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-log-test-"));
	const dbPath = join(tempDir, "tyr.db");
	process.env.TYR_DB_PATH = dbPath;
	// Point config at the temp dir so tests don't read production config
	process.env.TYR_CONFIG_FILE = join(tempDir, "config.json");
	return tempDir;
}

describe("log (SQLite)", () => {
	test("appendLogEntry inserts a row", async () => {
		await setupTempDb();
		appendLogEntry(makeEntry());
		const entries = readLogEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0]?.tool_name).toBe("Bash");
		expect(entries[0]?.decision).toBe("abstain");
	});

	test("readLogEntries returns empty for new DB", async () => {
		await setupTempDb();
		const entries = readLogEntries();
		expect(entries).toEqual([]);
	});

	test("multiple entries preserve order", async () => {
		await setupTempDb();
		appendLogEntry(makeEntry({ session_id: "s1" }));
		appendLogEntry(makeEntry({ session_id: "s2" }));
		appendLogEntry(makeEntry({ session_id: "s3" }));

		const entries = readLogEntries();
		expect(entries).toHaveLength(3);
		expect(entries[0]?.session_id).toBe("s1");
		expect(entries[2]?.session_id).toBe("s3");
	});

	test("readLogEntries with last option", async () => {
		await setupTempDb();
		appendLogEntry(makeEntry({ session_id: "s1" }));
		appendLogEntry(makeEntry({ session_id: "s2" }));
		appendLogEntry(makeEntry({ session_id: "s3" }));

		const last2 = readLogEntries({ last: 2 });
		expect(last2).toHaveLength(2);
		expect(last2[0]?.session_id).toBe("s2");
		expect(last2[1]?.session_id).toBe("s3");
	});

	test("appendLogEntry with LLM log data", async () => {
		await setupTempDb();
		appendLogEntry(makeEntry({ session_id: "llm-test" }), {
			prompt: "Is this safe?",
			model: "haiku",
		});

		const entries = readLogEntries();
		expect(entries).toHaveLength(1);

		const db = getDb();
		const logId = entries[0]?.id as number;
		const llmRow = db
			.query("SELECT * FROM llm_logs WHERE log_id = ?")
			.get(logId) as { prompt: string; model: string } | null;
		expect(llmRow).not.toBeNull();
		expect(llmRow?.prompt).toBe("Is this safe?");
		expect(llmRow?.model).toBe("haiku");
	});

	test("log entry round-trips all fields", async () => {
		await setupTempDb();
		const entry = makeEntry({
			decision: "allow",
			provider: "chained-commands",
			duration_ms: 42,
			reason: "matched pattern",
			mode: "shadow",
		});
		appendLogEntry(entry);

		const entries = readLogEntries();
		expect(entries).toHaveLength(1);
		const e = entries[0] as LogRow;
		expect(e.timestamp).toBeNumber();
		expect(e.tool_name).toBe("Bash");
		expect(e.tool_input).toBe("echo hello");
		expect(e.input).toBe('{"command":"echo hello"}');
		expect(e.decision).toBe("allow");
		expect(e.provider).toBe("chained-commands");
		expect(e.duration_ms).toBe(42);
		expect(e.reason).toBe("matched pattern");
		expect(e.mode).toBe("shadow");
		expect(e.session_id).toBe("test-session");
	});

	test("filter by decision", async () => {
		await setupTempDb();
		appendLogEntry(makeEntry({ decision: "allow" }));
		appendLogEntry(makeEntry({ decision: "deny" }));
		appendLogEntry(makeEntry({ decision: "abstain" }));

		const entries = readLogEntries({ decision: "allow" });
		expect(entries).toHaveLength(1);
		expect(entries[0]?.decision).toBe("allow");
	});

	test("clearLogs deletes all entries", async () => {
		await setupTempDb();
		appendLogEntry(makeEntry({ session_id: "s1" }));
		appendLogEntry(makeEntry({ session_id: "s2" }));
		appendLogEntry(makeEntry({ session_id: "s3" }));

		const deleted = clearLogs();
		expect(deleted).toBe(3);
		expect(readLogEntries()).toEqual([]);
	});

	test("clearLogs also deletes llm_logs", async () => {
		await setupTempDb();
		appendLogEntry(makeEntry(), { prompt: "test prompt", model: "haiku" });

		clearLogs();

		const db = getDb();
		const llmRows = db.query("SELECT * FROM llm_logs").all();
		expect(llmRows).toEqual([]);
	});

	test("clearLogs returns 0 on empty DB", async () => {
		await setupTempDb();
		expect(clearLogs()).toBe(0);
	});

	test("filter by since", async () => {
		await setupTempDb();
		const now = Date.now();
		appendLogEntry(makeEntry({ timestamp: now - 10000 }));
		appendLogEntry(makeEntry({ timestamp: now }));

		const entries = readLogEntries({ since: now - 5000 });
		expect(entries).toHaveLength(1);
	});
});

describe("parseRetention", () => {
	test("parses days", () => {
		expect(parseRetention("30d")).toBe(30 * 86_400_000);
	});

	test("parses hours", () => {
		expect(parseRetention("12h")).toBe(12 * 3_600_000);
	});

	test("parses minutes", () => {
		expect(parseRetention("45m")).toBe(45 * 60_000);
	});

	test("parses seconds", () => {
		expect(parseRetention("60s")).toBe(60_000);
	});

	test("returns null for '0' (disabled)", () => {
		expect(parseRetention("0")).toBeNull();
	});

	test("returns null for zero-amount durations", () => {
		expect(parseRetention("0d")).toBeNull();
		expect(parseRetention("0h")).toBeNull();
		expect(parseRetention("0s")).toBeNull();
	});

	test("returns null for invalid input", () => {
		expect(parseRetention("abc")).toBeNull();
		expect(parseRetention("")).toBeNull();
		expect(parseRetention("30x")).toBeNull();
	});
});

describe("truncateOldLogs", () => {
	test("deletes entries older than retention", async () => {
		await setupTempDb();
		const now = Date.now();
		appendLogEntry(makeEntry({ timestamp: now - 86_400_000 * 31 }));
		appendLogEntry(makeEntry({ timestamp: now - 86_400_000 * 10 }));
		appendLogEntry(makeEntry({ timestamp: now }));

		const deleted = truncateOldLogs("30d");
		expect(deleted).toBe(1);
		expect(readLogEntries()).toHaveLength(2);
	});

	test("deletes associated llm_logs", async () => {
		await setupTempDb();
		const now = Date.now();
		appendLogEntry(makeEntry({ timestamp: now - 86_400_000 * 31 }), {
			prompt: "old prompt",
			model: "haiku",
		});
		appendLogEntry(makeEntry({ timestamp: now }), {
			prompt: "new prompt",
			model: "haiku",
		});

		truncateOldLogs("30d");

		const db = getDb();
		const llmRows = db.query("SELECT * FROM llm_logs").all();
		expect(llmRows).toHaveLength(1);
	});

	test("no-op when retention is '0' (disabled)", async () => {
		await setupTempDb();
		const now = Date.now();
		appendLogEntry(makeEntry({ timestamp: now - 86_400_000 * 365 }));

		const deleted = truncateOldLogs("0");
		expect(deleted).toBe(0);
		expect(readLogEntries()).toHaveLength(1);
	});

	test("no-op when no entries are old enough", async () => {
		await setupTempDb();
		appendLogEntry(makeEntry({ timestamp: Date.now() }));

		const deleted = truncateOldLogs("30d");
		expect(deleted).toBe(0);
		expect(readLogEntries()).toHaveLength(1);
	});

	test("returns 0 on empty DB", async () => {
		await setupTempDb();
		expect(truncateOldLogs("1d")).toBe(0);
	});
});

const VALID_REQUEST = {
	session_id: "abc123",
	transcript_path: "/path/to/transcript.jsonl",
	cwd: "/working/directory",
	permission_mode: "default",
	hook_event_name: "PermissionRequest",
	tool_name: "Bash",
	tool_input: { command: "echo hello" },
};

describe("tyr judge logging (integration)", () => {
	test(
		"judge writes a log entry on valid request",
		async () => {
			const dir = await setupTempDb();
			const dbPath = join(dir, "tyr.db");
			const proc = Bun.spawn(["bun", "run", "src/index.ts", "judge"], {
				cwd: `${import.meta.dir}/../..`,
				stdout: "pipe",
				stderr: "pipe",
				stdin: new Response(JSON.stringify(VALID_REQUEST)).body,
				env: {
					...process.env,
					TYR_DB_PATH: dbPath,
					CLAUDE_CONFIG_DIR: join(dir, "empty-config"),
				},
			});
			await proc.exited;

			const entries = readLogEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0]?.tool_name).toBe("Bash");
			expect(entries[0]?.decision).toBe("abstain");
			expect(entries[0]?.session_id).toBe("abc123");
			expect(entries[0]?.cwd).toBe("/working/directory");
		},
		{ timeout: 10_000 },
	);

	test(
		"shadow mode sets mode field in log entry",
		async () => {
			const dir = await setupTempDb();
			const dbPath = join(dir, "tyr.db");
			const proc = Bun.spawn(
				["bun", "run", "src/index.ts", "judge", "--shadow"],
				{
					cwd: `${import.meta.dir}/../..`,
					stdout: "pipe",
					stderr: "pipe",
					stdin: new Response(JSON.stringify(VALID_REQUEST)).body,
					env: {
						...process.env,
						TYR_DB_PATH: dbPath,
						CLAUDE_CONFIG_DIR: join(dir, "empty-config"),
					},
				},
			);
			await proc.exited;

			const entries = readLogEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0]?.mode).toBe("shadow");
			expect(entries[0]?.decision).toBe("abstain");
		},
		{ timeout: 10_000 },
	);

	test(
		"audit mode logs request without running pipeline",
		async () => {
			const dir = await setupTempDb();
			const dbPath = join(dir, "tyr.db");
			const proc = Bun.spawn(
				["bun", "run", "src/index.ts", "judge", "--audit"],
				{
					cwd: `${import.meta.dir}/../..`,
					stdout: "pipe",
					stderr: "pipe",
					stdin: new Response(JSON.stringify(VALID_REQUEST)).body,
					env: {
						...process.env,
						TYR_DB_PATH: dbPath,
						CLAUDE_CONFIG_DIR: join(dir, "empty-config"),
					},
				},
			);
			await proc.exited;

			const entries = readLogEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0]?.mode).toBe("audit");
			expect(entries[0]?.decision).toBe("abstain");
			expect(entries[0]?.provider).toBeNull();
		},
		{ timeout: 10_000 },
	);

	test(
		"--verbose-log includes LLM fields in llm_logs",
		async () => {
			const dir = await setupTempDb();
			const dbPath = join(dir, "tyr.db");
			const proc = Bun.spawn(
				["bun", "run", "src/index.ts", "judge", "--verbose-log"],
				{
					cwd: `${import.meta.dir}/../..`,
					stdout: "pipe",
					stderr: "pipe",
					stdin: new Response(JSON.stringify(VALID_REQUEST)).body,
					env: {
						...process.env,
						TYR_DB_PATH: dbPath,
						CLAUDE_CONFIG_DIR: join(dir, "empty-config"),
					},
				},
			);
			expect(await proc.exited).toBe(0);

			const entries = readLogEntries();
			expect(entries).toHaveLength(1);

			const db = getDb();
			const logId = entries[0]?.id as number;
			const llmRow = db
				.query("SELECT * FROM llm_logs WHERE log_id = ?")
				.get(logId) as { prompt: string; model: string } | null;
			expect(llmRow).not.toBeNull();
			expect(llmRow?.prompt).toContain("permission checker");
			expect(llmRow?.model).toBe("haiku");
		},
		{ timeout: 10_000 },
	);
});
