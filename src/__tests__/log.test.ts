import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLogEntry, type LogEntry, readLogEntries } from "../log.ts";
import { saveEnv } from "./helpers/index.ts";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: "2026-02-14T12:00:00.000Z",
		cwd: "/test/dir",
		tool_name: "Bash",
		tool_input: { command: "echo hello" },
		decision: "abstain",
		provider: null,
		duration_ms: 5,
		session_id: "test-session",
		...overrides,
	};
}

let tempDir: string;
let logFile: string;
const restoreEnv = saveEnv("TYR_LOG_FILE");

afterEach(async () => {
	restoreEnv();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function setupTempLog(): Promise<void> {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-log-test-"));
	logFile = join(tempDir, "log.jsonl");
	process.env.TYR_LOG_FILE = logFile;
}

describe("log", () => {
	test("creates log file on first write", async () => {
		await setupTempLog();
		await appendLogEntry(makeEntry());
		const file = Bun.file(logFile);
		expect(await file.exists()).toBe(true);
	});

	test("writes valid JSONL", async () => {
		await setupTempLog();
		await appendLogEntry(makeEntry());
		const text = await Bun.file(logFile).text();
		const parsed = JSON.parse(text.trim());
		expect(parsed.tool_name).toBe("Bash");
		expect(parsed.decision).toBe("abstain");
	});

	test("appends multiple entries", async () => {
		await setupTempLog();
		await appendLogEntry(makeEntry({ session_id: "s1" }));
		await appendLogEntry(makeEntry({ session_id: "s2" }));
		await appendLogEntry(makeEntry({ session_id: "s3" }));

		const entries = await readLogEntries();
		expect(entries).toHaveLength(3);
		expect(entries[0]?.session_id).toBe("s1");
		expect(entries[2]?.session_id).toBe("s3");
	});

	test("readLogEntries with last param", async () => {
		await setupTempLog();
		await appendLogEntry(makeEntry({ session_id: "s1" }));
		await appendLogEntry(makeEntry({ session_id: "s2" }));
		await appendLogEntry(makeEntry({ session_id: "s3" }));

		const last2 = await readLogEntries(2);
		expect(last2).toHaveLength(2);
		expect(last2[0]?.session_id).toBe("s2");
		expect(last2[1]?.session_id).toBe("s3");
	});

	test("readLogEntries returns empty for missing file", async () => {
		await setupTempLog();
		const entries = await readLogEntries();
		expect(entries).toEqual([]);
	});

	test("readLogEntries skips malformed JSON lines", async () => {
		await setupTempLog();
		await appendLogEntry(makeEntry({ session_id: "valid1" }));
		await appendFile(logFile, "not valid json{{{corrupt\n", "utf-8");
		await appendLogEntry(makeEntry({ session_id: "valid2" }));

		const entries = await readLogEntries();
		expect(entries).toHaveLength(2);
		expect(entries[0]?.session_id).toBe("valid1");
		expect(entries[1]?.session_id).toBe("valid2");
	});

	test("log entry schema has all required fields", async () => {
		await setupTempLog();
		const entry = makeEntry({
			decision: "allow",
			provider: "chained-commands",
			duration_ms: 42,
		});
		await appendLogEntry(entry);

		const entries = await readLogEntries();
		expect(entries).toHaveLength(1);
		const e = entries[0] as LogEntry;
		expect(e.timestamp).toBeString();
		expect(e.tool_name).toBeString();
		expect(e.tool_input).toBeObject();
		expect(["allow", "deny", "abstain", "error"]).toContain(e.decision);
		expect(e.provider).toBe("chained-commands");
		expect(e.duration_ms).toBeNumber();
		expect(e.session_id).toBeString();
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
			await setupTempLog();
			const proc = Bun.spawn(["bun", "run", "src/index.ts", "judge"], {
				cwd: `${import.meta.dir}/../..`,
				stdout: "pipe",
				stderr: "pipe",
				stdin: new Response(JSON.stringify(VALID_REQUEST)).body,
				env: { ...process.env, TYR_LOG_FILE: logFile },
			});
			await proc.exited;

			const entries = await readLogEntries();
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
			await setupTempLog();
			const proc = Bun.spawn(
				["bun", "run", "src/index.ts", "judge", "--shadow"],
				{
					cwd: `${import.meta.dir}/../..`,
					stdout: "pipe",
					stderr: "pipe",
					stdin: new Response(JSON.stringify(VALID_REQUEST)).body,
					env: { ...process.env, TYR_LOG_FILE: logFile },
				},
			);
			await proc.exited;

			const entries = await readLogEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0]?.mode).toBe("shadow");
			expect(entries[0]?.decision).toBe("abstain");
		},
		{ timeout: 10_000 },
	);
});
