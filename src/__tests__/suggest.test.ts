import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Write a mock global Claude settings file with allow rules.
 *  When CLAUDE_CONFIG_DIR=dir, the global settings path is dir/settings.json. */
async function writeGlobalSettings(
	configDir: string,
	rules: string[],
): Promise<string> {
	await mkdir(configDir, { recursive: true });
	const path = join(configDir, "settings.json");
	await writeFile(
		path,
		JSON.stringify({ permissions: { allow: rules } }),
		"utf-8",
	);
	return path;
}

describe("tyr suggest", () => {
	test(
		"no suggestions with empty database",
		async () => {
			const dbPath = await setupTempDb();
			const result = await runCli("suggest", ["--json"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.trim())).toEqual([]);
		},
		{ timeout: 10_000 },
	);

	test(
		"suggests commands approved >= min-count times",
		async () => {
			const dbPath = await setupTempDb();
			// "bun test" allowed 6 times, "echo hi" allowed 2 times
			for (let i = 0; i < 6; i++) {
				insertEntries(makeEntry({ tool_input: "bun test" }));
			}
			for (let i = 0; i < 2; i++) {
				insertEntries(makeEntry({ tool_input: "echo hi" }));
			}
			resetDbInstance();

			const result = await runCli("suggest", ["--json", "--min-count", "5"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			const suggestions = JSON.parse(result.stdout.trim());
			expect(suggestions).toHaveLength(1);
			expect(suggestions[0].command).toBe("bun test");
			expect(suggestions[0].count).toBe(6);
			expect(suggestions[0].rule).toBe("Bash(bun test)");
		},
		{ timeout: 10_000 },
	);

	test(
		"excludes commands already in allow rules",
		async () => {
			const dbPath = await setupTempDb();
			// Both commands approved enough times
			for (let i = 0; i < 10; i++) {
				insertEntries(makeEntry({ tool_input: "bun test" }));
				insertEntries(makeEntry({ tool_input: "bun lint" }));
			}
			resetDbInstance();

			// "bun test" already allowed
			await writeGlobalSettings(tempDir, ["Bash(bun test)"]);

			const result = await runCli("suggest", ["--json", "--min-count", "5"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			const suggestions = JSON.parse(result.stdout.trim());
			expect(suggestions).toHaveLength(1);
			expect(suggestions[0].command).toBe("bun lint");
		},
		{ timeout: 10_000 },
	);

	test(
		"excludes commands matched by wildcard allow rules",
		async () => {
			const dbPath = await setupTempDb();
			for (let i = 0; i < 10; i++) {
				insertEntries(makeEntry({ tool_input: "bun test" }));
				insertEntries(makeEntry({ tool_input: "bun lint" }));
			}
			resetDbInstance();

			// Wildcard covers both
			await writeGlobalSettings(tempDir, ["Bash(bun *)"]);

			const result = await runCli("suggest", ["--json", "--min-count", "5"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			const suggestions = JSON.parse(result.stdout.trim());
			expect(suggestions).toEqual([]);
		},
		{ timeout: 10_000 },
	);

	test(
		"ignores shadow/audit mode entries",
		async () => {
			const dbPath = await setupTempDb();
			for (let i = 0; i < 10; i++) {
				insertEntries(makeEntry({ tool_input: "bun test", mode: "shadow" }));
			}
			resetDbInstance();

			const result = await runCli("suggest", ["--json", "--min-count", "5"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.trim())).toEqual([]);
		},
		{ timeout: 10_000 },
	);

	test(
		"ignores non-allow decisions",
		async () => {
			const dbPath = await setupTempDb();
			for (let i = 0; i < 10; i++) {
				insertEntries(makeEntry({ tool_input: "rm -rf /", decision: "deny" }));
			}
			resetDbInstance();

			const result = await runCli("suggest", ["--json", "--min-count", "5"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.trim())).toEqual([]);
		},
		{ timeout: 10_000 },
	);

	test(
		"--apply writes rules to global settings",
		async () => {
			const dbPath = await setupTempDb();
			for (let i = 0; i < 10; i++) {
				insertEntries(makeEntry({ tool_input: "bun test" }));
			}
			resetDbInstance();

			const result = await runCli(
				"suggest",
				["--apply", "--global", "--min-count", "5"],
				{ env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir } },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Bash(bun test)");

			// Verify the settings file was written
			const settingsPath = join(tempDir, "settings.json");
			const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
			expect(settings.permissions.allow).toContain("Bash(bun test)");
		},
		{ timeout: 10_000 },
	);

	test(
		"--apply merges without clobbering existing rules",
		async () => {
			const dbPath = await setupTempDb();
			for (let i = 0; i < 10; i++) {
				insertEntries(makeEntry({ tool_input: "bun test" }));
			}
			resetDbInstance();

			// Pre-existing rule
			const settingsPath = join(tempDir, "settings.json");
			await mkdir(tempDir, { recursive: true });
			await writeFile(
				settingsPath,
				JSON.stringify({
					permissions: { allow: ["Bash(git status)"] },
				}),
				"utf-8",
			);

			const result = await runCli(
				"suggest",
				["--apply", "--global", "--min-count", "5"],
				{ env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir } },
			);
			expect(result.exitCode).toBe(0);

			const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
			expect(settings.permissions.allow).toContain("Bash(git status)");
			expect(settings.permissions.allow).toContain("Bash(bun test)");
		},
		{ timeout: 10_000 },
	);

	test(
		"dry-run has no side effects",
		async () => {
			const dbPath = await setupTempDb();
			for (let i = 0; i < 10; i++) {
				insertEntries(makeEntry({ tool_input: "bun test" }));
			}
			resetDbInstance();

			const settingsPath = join(tempDir, "settings.json");
			await mkdir(tempDir, { recursive: true });
			await writeFile(settingsPath, "{}", "utf-8");
			const before = await readFile(settingsPath, "utf-8");

			const result = await runCli("suggest", ["--min-count", "5"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Bash(bun test)");
			expect(result.stdout).toContain("--apply");

			const after = await readFile(settingsPath, "utf-8");
			expect(after).toBe(before);
		},
		{ timeout: 10_000 },
	);

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
		"only suggests Bash commands",
		async () => {
			const dbPath = await setupTempDb();
			for (let i = 0; i < 10; i++) {
				insertEntries(
					makeEntry({ tool_name: "Read", tool_input: "/etc/passwd" }),
				);
			}
			resetDbInstance();

			const result = await runCli("suggest", ["--json", "--min-count", "5"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.trim())).toEqual([]);
		},
		{ timeout: 10_000 },
	);

	test(
		"human-readable output shows rules and counts",
		async () => {
			const dbPath = await setupTempDb();
			for (let i = 0; i < 7; i++) {
				insertEntries(makeEntry({ tool_input: "bun test" }));
			}
			resetDbInstance();

			const result = await runCli("suggest", ["--min-count", "5"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: tempDir },
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Bash(bun test)");
			expect(result.stdout).toContain("7 approvals");
		},
		{ timeout: 10_000 },
	);
});
