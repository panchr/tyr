import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSuggestions } from "../commands/suggest.ts";
import { resetDbInstance } from "../db.ts";
import { appendLogEntry, type LogEntry } from "../log.ts";
import { saveEnv } from "./helpers/index.ts";
import { runCli } from "./helpers/subprocess.ts";

const restoreDbEnv = saveEnv("TYR_DB_PATH");

let tempDir: string;

afterEach(async () => {
	resetDbInstance();
	restoreDbEnv();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = "";
	}
});

async function setupTempDb(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-suggest-test-"));
	const dbPath = join(tempDir, "tyr.db");
	process.env.TYR_DB_PATH = dbPath;
	return dbPath;
}

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: Date.now(),
		cwd: "/test/dir",
		tool_name: "Bash",
		tool_input: "echo hello",
		input: '{"command":"echo hello"}',
		decision: "allow",
		provider: "chained-commands",
		duration_ms: 5,
		session_id: "test-session",
		...overrides,
	};
}

function insertEntries(...entries: LogEntry[]): void {
	for (const e of entries) {
		appendLogEntry(e);
	}
}

describe("getSuggestions", () => {
	test("returns empty for empty database", async () => {
		await setupTempDb();
		const suggestions = getSuggestions(5, []);
		expect(suggestions).toEqual([]);
	});

	test("suggests commands approved >= min-count times", async () => {
		await setupTempDb();
		for (let i = 0; i < 6; i++) {
			insertEntries(makeEntry({ tool_input: "bun test" }));
		}
		for (let i = 0; i < 2; i++) {
			insertEntries(makeEntry({ tool_input: "echo hi" }));
		}

		const suggestions = getSuggestions(5, []);
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]?.command).toBe("bun test");
		expect(suggestions[0]?.count).toBe(6);
		expect(suggestions[0]?.rule).toBe("Bash(bun test)");
	});

	test("excludes commands already in allow rules", async () => {
		await setupTempDb();
		for (let i = 0; i < 10; i++) {
			insertEntries(makeEntry({ tool_input: "bun test" }));
			insertEntries(makeEntry({ tool_input: "bun lint" }));
		}

		const suggestions = getSuggestions(5, ["bun test"]);
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]?.command).toBe("bun lint");
	});

	test("excludes commands matched by wildcard allow rules", async () => {
		await setupTempDb();
		for (let i = 0; i < 10; i++) {
			insertEntries(makeEntry({ tool_input: "bun test" }));
			insertEntries(makeEntry({ tool_input: "bun lint" }));
		}

		const suggestions = getSuggestions(5, ["bun *"]);
		expect(suggestions).toEqual([]);
	});

	test("ignores shadow/audit mode entries", async () => {
		await setupTempDb();
		for (let i = 0; i < 10; i++) {
			insertEntries(makeEntry({ tool_input: "bun test", mode: "shadow" }));
		}

		const suggestions = getSuggestions(5, []);
		expect(suggestions).toEqual([]);
	});

	test("ignores non-allow decisions", async () => {
		await setupTempDb();
		for (let i = 0; i < 10; i++) {
			insertEntries(makeEntry({ tool_input: "rm -rf /", decision: "deny" }));
		}

		const suggestions = getSuggestions(5, []);
		expect(suggestions).toEqual([]);
	});

	test("only suggests Bash commands", async () => {
		await setupTempDb();
		for (let i = 0; i < 10; i++) {
			insertEntries(
				makeEntry({ tool_name: "Read", tool_input: "/etc/passwd" }),
			);
		}

		const suggestions = getSuggestions(5, []);
		expect(suggestions).toEqual([]);
	});

	test("scopes suggestions to cwd when provided", async () => {
		await setupTempDb();
		for (let i = 0; i < 10; i++) {
			insertEntries(
				makeEntry({ tool_input: "bun test", cwd: "/other/project" }),
			);
		}
		for (let i = 0; i < 10; i++) {
			insertEntries(makeEntry({ tool_input: "bun lint", cwd: "/test/dir" }));
		}

		const scoped = getSuggestions(5, [], "/test/dir");
		expect(scoped).toHaveLength(1);
		expect(scoped[0]?.command).toBe("bun lint");

		const all = getSuggestions(5, []);
		expect(all).toHaveLength(2);
	});

	test("includes commands from subdirectories when scoped", async () => {
		await setupTempDb();
		for (let i = 0; i < 10; i++) {
			insertEntries(
				makeEntry({ tool_input: "bun test", cwd: "/test/dir/subdir" }),
			);
		}

		const suggestions = getSuggestions(5, [], "/test/dir");
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]?.command).toBe("bun test");
	});
});

describe("tyr suggest CLI", () => {
	test(
		"rejects --global and --project together",
		async () => {
			const dbPath = await setupTempDb();
			const result = await runCli("suggest", ["--global", "--project"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				"Cannot specify both --global and --project",
			);
		},
		{ timeout: 10_000 },
	);

	test(
		"rejects invalid --min-count",
		async () => {
			const dbPath = await setupTempDb();
			const result = await runCli("suggest", ["--min-count", "abc"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Invalid --min-count");
		},
		{ timeout: 10_000 },
	);

	test(
		"rejects --min-count 0",
		async () => {
			const dbPath = await setupTempDb();
			const result = await runCli("suggest", ["--min-count", "0"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Invalid --min-count");
		},
		{ timeout: 10_000 },
	);

	test(
		"prints message when no suggestions found",
		async () => {
			const dbPath = await setupTempDb();
			const result = await runCli("suggest", ["--all"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("No new suggestions found.");
		},
		{ timeout: 10_000 },
	);
});
