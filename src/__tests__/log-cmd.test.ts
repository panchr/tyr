import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogEntry } from "../log.ts";

let tempDir: string;
let logFile: string;

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: "2026-02-14T12:00:00.000Z",
		tool_name: "Bash",
		tool_input: { command: "echo hello" },
		decision: "abstain",
		provider: null,
		duration_ms: 5,
		session_id: "test-session",
		...overrides,
	};
}

async function writeEntries(...entries: LogEntry[]): Promise<void> {
	const lines = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
	await appendFile(logFile, lines, "utf-8");
}

async function runLog(
	...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", "src/index.ts", "log", ...args], {
		cwd: `${import.meta.dir}/../..`,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, TYR_LOG_FILE: logFile },
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
	logFile = join(tempDir, "log.jsonl");
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("tyr log", () => {
	test("empty log shows friendly message", async () => {
		const { stdout, exitCode } = await runLog();
		expect(exitCode).toBe(0);
		expect(stdout).toContain("No log entries yet.");
	});

	test("displays entries with header", async () => {
		await writeEntries(makeEntry(), makeEntry({ tool_name: "Read" }));
		const { stdout, exitCode } = await runLog();
		expect(exitCode).toBe(0);
		expect(stdout).toContain("TIME");
		expect(stdout).toContain("TOOL");
		expect(stdout).toContain("Bash");
		expect(stdout).toContain("Read");
	});

	test("--last limits output", async () => {
		await writeEntries(
			makeEntry({ tool_input: { command: "cmd-one" } }),
			makeEntry({ tool_input: { command: "cmd-two" } }),
			makeEntry({ tool_input: { command: "cmd-three" } }),
		);
		const { stdout, exitCode } = await runLog("--last", "1");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("cmd-three");
		expect(stdout).not.toContain("cmd-one");
	});

	test("--json outputs valid JSONL", async () => {
		await writeEntries(
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
	});

	test("--json --last combines correctly", async () => {
		await writeEntries(
			makeEntry({ session_id: "a" }),
			makeEntry({ session_id: "b" }),
			makeEntry({ session_id: "c" }),
		);
		const { stdout, exitCode } = await runLog("--json", "--last", "2");
		expect(exitCode).toBe(0);
		const lines = stdout.trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0] as string).session_id).toBe("b");
	});

	test("shows command from tool_input", async () => {
		await writeEntries(makeEntry({ tool_input: { command: "bun test" } }));
		const { stdout } = await runLog();
		expect(stdout).toContain("bun test");
	});

	test("shows file_path when no command", async () => {
		await writeEntries(makeEntry({ tool_input: { file_path: "/etc/hosts" } }));
		const { stdout } = await runLog();
		expect(stdout).toContain("/etc/hosts");
	});

	test("rejects unknown flags", async () => {
		const { stderr, exitCode } = await runLog("-j");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Unknown option: -j");
	});
});
