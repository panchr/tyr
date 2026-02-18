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
	readLogEntries,
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
		const llmRow = db
			.query("SELECT * FROM llm_logs WHERE log_id = ?")
			.get(entries[0]?.id) as { prompt: string; model: string } | null;
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
			const llmRow = db
				.query("SELECT * FROM llm_logs WHERE log_id = ?")
				.get(entries[0]?.id) as { prompt: string; model: string } | null;
			expect(llmRow).not.toBeNull();
			expect(llmRow?.prompt).toContain("permission checker");
			expect(llmRow?.model).toBe("haiku");
		},
		{ timeout: 10_000 },
	);
});
