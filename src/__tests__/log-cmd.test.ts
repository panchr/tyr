import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDbInstance } from "../db.ts";
import { appendLogEntry, type LlmLogEntry, type LogEntry } from "../log.ts";
import { saveEnv } from "./helpers/index.ts";

let tempDir: string;
let dbPath: string;
const restoreDbEnv = saveEnv("TYR_DB_PATH");

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: new Date("2026-02-14T12:00:00.000Z").getTime(),
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

function writeEntries(
	...entries: (LogEntry | [LogEntry, LlmLogEntry])[]
): void {
	for (const e of entries) {
		if (Array.isArray(e)) {
			appendLogEntry(e[0], e[1]);
		} else {
			appendLogEntry(e);
		}
	}
}

async function runLog(
	...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", "src/index.ts", "log", ...args], {
		cwd: `${import.meta.dir}/../..`,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			TYR_DB_PATH: dbPath,
			CLAUDE_CONFIG_DIR: join(tempDir, "empty-config"),
			TYR_CONFIG_FILE: join(tempDir, "tyr-config.json"),
		},
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-log-cmd-"));
	dbPath = join(tempDir, "tyr.db");
	process.env.TYR_DB_PATH = dbPath;
});

afterEach(async () => {
	resetDbInstance();
	restoreDbEnv();
	await rm(tempDir, { recursive: true, force: true });
});

describe("tyr log", () => {
	test(
		"empty log shows friendly message",
		async () => {
			const { stdout, exitCode } = await runLog();
			expect(exitCode).toBe(0);
			expect(stdout).toContain("No log entries yet.");
		},
		{ timeout: 10_000 },
	);

	test(
		"displays entries with header",
		async () => {
			writeEntries(makeEntry(), makeEntry({ tool_name: "Read" }));
			const { stdout, exitCode } = await runLog();
			expect(exitCode).toBe(0);
			expect(stdout).toContain("TIME");
			expect(stdout).toContain("DECISION");
			expect(stdout).toContain("PROJECT");
			expect(stdout).toContain("TOOL");
			expect(stdout).toContain("Bash");
			expect(stdout).toContain("Read");
		},
		{ timeout: 10_000 },
	);

	test(
		"displays cwd in output",
		async () => {
			writeEntries(makeEntry({ cwd: "/my/project" }));
			const { stdout } = await runLog();
			expect(stdout).toContain("/my/project");
		},
		{ timeout: 10_000 },
	);

	test(
		"--last limits output",
		async () => {
			writeEntries(
				makeEntry({ tool_input: "cmd-one" }),
				makeEntry({ tool_input: "cmd-two" }),
				makeEntry({ tool_input: "cmd-three" }),
			);
			const { stdout, exitCode } = await runLog("--last", "1");
			expect(exitCode).toBe(0);
			expect(stdout).toContain("cmd-three");
			expect(stdout).not.toContain("cmd-one");
		},
		{ timeout: 10_000 },
	);

	test(
		"--json outputs valid JSONL",
		async () => {
			writeEntries(
				makeEntry({ session_id: "j1" }),
				makeEntry({ session_id: "j2" }),
			);
			const { stdout, exitCode } = await runLog("--json");
			expect(exitCode).toBe(0);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(2);
			const first = JSON.parse(lines[0] as string);
			expect(first.session_id).toBe("j1");
			const second = JSON.parse(lines[1] as string);
			expect(second.session_id).toBe("j2");
		},
		{ timeout: 10_000 },
	);

	test(
		"--json --last combines correctly",
		async () => {
			writeEntries(
				makeEntry({ session_id: "a" }),
				makeEntry({ session_id: "b" }),
				makeEntry({ session_id: "c" }),
			);
			const { stdout, exitCode } = await runLog("--json", "--last", "2");
			expect(exitCode).toBe(0);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(2);
			expect(JSON.parse(lines[0] as string).session_id).toBe("b");
		},
		{ timeout: 10_000 },
	);

	test(
		"displays timestamps in local timezone",
		async () => {
			writeEntries(
				makeEntry({
					timestamp: new Date("2026-02-14T12:00:00.000Z").getTime(),
				}),
			);
			const { stdout, exitCode } = await runLog();
			expect(exitCode).toBe(0);
			// Local time should not end with 'Z' (UTC indicator)
			const lines = stdout.trim().split("\n");
			// First line is header, second is the entry
			expect(lines.length).toBeGreaterThanOrEqual(2);
			const entryLine = lines[1] as string;
			// Should match YYYY-MM-DD HH:MM:SS format without Z
			expect(entryLine).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
			expect(entryLine).not.toMatch(/\d{2}:\d{2}:\d{2}Z/);
		},
		{ timeout: 10_000 },
	);

	test(
		"shows command from tool_input",
		async () => {
			writeEntries(makeEntry({ tool_input: "bun test" }));
			const { stdout } = await runLog();
			expect(stdout).toContain("bun test");
		},
		{ timeout: 10_000 },
	);

	test(
		"rejects unknown flags",
		async () => {
			const { stderr, exitCode } = await runLog("-j");
			expect(exitCode).toBe(1);
			expect(stderr).toContain("Unknown option: -j");
		},
		{ timeout: 10_000 },
	);

	test(
		"--decision filters by decision",
		async () => {
			writeEntries(
				makeEntry({ decision: "allow", provider: "chained-commands" }),
				makeEntry({ decision: "deny", provider: "llm" }),
				makeEntry({ decision: "abstain" }),
			);
			const { stdout, exitCode } = await runLog(
				"--json",
				"--decision",
				"allow",
			);
			expect(exitCode).toBe(0);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(1);
			expect(JSON.parse(lines[0] as string).decision).toBe("allow");
		},
		{ timeout: 10_000 },
	);

	test(
		"--provider filters by provider",
		async () => {
			writeEntries(
				makeEntry({ decision: "allow", provider: "chained-commands" }),
				makeEntry({ decision: "allow", provider: "llm" }),
			);
			const { stdout, exitCode } = await runLog("--json", "--provider", "llm");
			expect(exitCode).toBe(0);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(1);
			expect(JSON.parse(lines[0] as string).provider).toBe("llm");
		},
		{ timeout: 10_000 },
	);

	test(
		"--cwd filters by path prefix",
		async () => {
			writeEntries(
				makeEntry({ cwd: "/home/user/project-a" }),
				makeEntry({ cwd: "/home/user/project-b" }),
			);
			const { stdout, exitCode } = await runLog(
				"--json",
				"--cwd",
				"/home/user/project-a",
			);
			expect(exitCode).toBe(0);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(1);
			expect(JSON.parse(lines[0] as string).cwd).toBe("/home/user/project-a");
		},
		{ timeout: 10_000 },
	);

	test(
		"--since filters by timestamp",
		async () => {
			writeEntries(
				makeEntry({
					timestamp: new Date("2026-02-13T12:00:00.000Z").getTime(),
				}),
				makeEntry({
					timestamp: new Date("2026-02-15T12:00:00.000Z").getTime(),
				}),
			);
			const { stdout, exitCode } = await runLog(
				"--json",
				"--since",
				"2026-02-14T00:00:00Z",
			);
			expect(exitCode).toBe(0);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(1);
			const row = JSON.parse(lines[0] as string);
			expect(row.timestamp).toBe(
				new Date("2026-02-15T12:00:00.000Z").getTime(),
			);
		},
		{ timeout: 10_000 },
	);

	test(
		"--until filters by timestamp",
		async () => {
			writeEntries(
				makeEntry({
					timestamp: new Date("2026-02-13T12:00:00.000Z").getTime(),
				}),
				makeEntry({
					timestamp: new Date("2026-02-15T12:00:00.000Z").getTime(),
				}),
			);
			const { stdout, exitCode } = await runLog(
				"--json",
				"--until",
				"2026-02-14T00:00:00Z",
			);
			expect(exitCode).toBe(0);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(1);
			const row = JSON.parse(lines[0] as string);
			expect(row.timestamp).toBe(
				new Date("2026-02-13T12:00:00.000Z").getTime(),
			);
		},
		{ timeout: 10_000 },
	);

	test(
		"filters are applied before --last",
		async () => {
			writeEntries(
				makeEntry({ decision: "allow", provider: "p1" }),
				makeEntry({ decision: "abstain" }),
				makeEntry({ decision: "allow", provider: "p2" }),
				makeEntry({ decision: "abstain" }),
				makeEntry({ decision: "allow", provider: "p3" }),
			);
			const { stdout, exitCode } = await runLog(
				"--json",
				"--decision",
				"allow",
				"--last",
				"2",
			);
			expect(exitCode).toBe(0);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(2);
			expect(JSON.parse(lines[0] as string).provider).toBe("p2");
			expect(JSON.parse(lines[1] as string).provider).toBe("p3");
		},
		{ timeout: 10_000 },
	);

	test(
		"multiple filters are ANDed",
		async () => {
			writeEntries(
				makeEntry({ decision: "allow", cwd: "/project-a", provider: "p1" }),
				makeEntry({ decision: "deny", cwd: "/project-a", provider: "p2" }),
				makeEntry({ decision: "allow", cwd: "/project-b", provider: "p3" }),
			);
			const { stdout, exitCode } = await runLog(
				"--json",
				"--decision",
				"allow",
				"--cwd",
				"/project-a",
			);
			expect(exitCode).toBe(0);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(1);
			expect(JSON.parse(lines[0] as string).provider).toBe("p1");
		},
		{ timeout: 10_000 },
	);

	test(
		"--verbose shows model and prompt in table mode",
		async () => {
			writeEntries([
				makeEntry({ tool_input: "echo hi" }),
				{ prompt: "Is this command safe?", model: "haiku" },
			]);
			const { stdout, exitCode } = await runLog("--verbose");
			expect(exitCode).toBe(0);
			expect(stdout).toContain("echo hi");
			expect(stdout).toContain("model: haiku");
			expect(stdout).toContain("prompt: Is this command safe?");
		},
		{ timeout: 10_000 },
	);

	test(
		"--verbose --json includes llm data",
		async () => {
			writeEntries([
				makeEntry({ session_id: "v1" }),
				{ prompt: "Check this", model: "sonnet" },
			]);
			const { stdout, exitCode } = await runLog("--verbose", "--json");
			expect(exitCode).toBe(0);
			const row = JSON.parse(stdout.trim());
			expect(row.session_id).toBe("v1");
			expect(row.llm).toBeDefined();
			expect(row.llm.model).toBe("sonnet");
			expect(row.llm.prompt).toBe("Check this");
			expect(row.llm.log_id).toBeUndefined();
		},
		{ timeout: 10_000 },
	);

	test(
		"--verbose with no llm logs shows no extra output",
		async () => {
			writeEntries(makeEntry({ tool_input: "ls" }));
			const { stdout, exitCode } = await runLog("--verbose");
			expect(exitCode).toBe(0);
			expect(stdout).toContain("ls");
			expect(stdout).not.toContain("model:");
			expect(stdout).not.toContain("prompt:");
		},
		{ timeout: 10_000 },
	);

	test(
		"invalid --since value errors",
		async () => {
			const { stderr, exitCode } = await runLog("--since", "not-a-date");
			expect(exitCode).toBe(1);
			expect(stderr).toContain("Invalid --since");
		},
		{ timeout: 10_000 },
	);
});
