import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDbInstance } from "../db.ts";
import { appendLogEntry, type LogEntry } from "../log.ts";
import { saveEnv } from "./helpers/index.ts";
import { runCli } from "./helpers/subprocess.ts";

const restoreDbEnv = saveEnv("TYR_DB_PATH");

let tempDir: string;

/** Env vars that prevent tests from using production config. */
function isolatedEnv(
	extras: Record<string, string> = {},
): Record<string, string> {
	return {
		CLAUDE_CONFIG_DIR: join(tempDir, "empty-config"),
		TYR_CONFIG_FILE: join(tempDir, "tyr-config.json"),
		...extras,
	};
}

afterEach(async () => {
	resetDbInstance();
	restoreDbEnv();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = "";
	}
});

async function setupTempDb(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-stats-test-"));
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
		decision: "abstain",
		provider: null,
		duration_ms: 5,
		session_id: "test-session",
		...overrides,
	};
}

describe("tyr stats", () => {
	test(
		"shows zeros with no data",
		async () => {
			const dbPath = await setupTempDb();
			const result = await runCli("stats", [], {
				env: isolatedEnv({ TYR_DB_PATH: dbPath }),
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Total checks: 0");
		},
		{ timeout: 10_000 },
	);

	test(
		"--json outputs valid JSON with correct structure",
		async () => {
			const dbPath = await setupTempDb();
			const result = await runCli("stats", ["--json"], {
				env: isolatedEnv({ TYR_DB_PATH: dbPath }),
			});
			expect(result.exitCode).toBe(0);
			const stats = JSON.parse(result.stdout.trim());
			expect(stats.total).toBe(0);
			expect(stats.decisions).toEqual({});
			expect(stats.cache).toEqual({ hits: 0, rate: 0 });
			expect(stats.providers).toEqual({});
			expect(stats.autoApprovals).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"counters match inserted data",
		async () => {
			const dbPath = await setupTempDb();

			// Insert test data
			appendLogEntry(
				makeEntry({ decision: "allow", provider: "chained-commands" }),
			);
			appendLogEntry(
				makeEntry({ decision: "allow", provider: "chained-commands" }),
			);
			appendLogEntry(makeEntry({ decision: "deny", provider: "llm" }));
			appendLogEntry(makeEntry({ decision: "abstain", provider: null }));
			appendLogEntry(
				makeEntry({
					decision: "allow",
					provider: "fail-open",
					cached: 1,
				}),
			);
			resetDbInstance();

			const result = await runCli("stats", ["--json"], {
				env: isolatedEnv({ TYR_DB_PATH: dbPath }),
			});
			expect(result.exitCode).toBe(0);
			const stats = JSON.parse(result.stdout.trim());

			expect(stats.total).toBe(5);
			expect(stats.decisions.allow).toBe(3);
			expect(stats.decisions.deny).toBe(1);
			expect(stats.decisions.abstain).toBe(1);
			expect(stats.autoApprovals).toBe(3);
			expect(stats.cache.hits).toBe(1);
			expect(stats.cache.rate).toBe(20);
			expect(stats.providers["chained-commands"]).toBe(2);
			expect(stats.providers.llm).toBe(1);
			expect(stats.providers["fail-open"]).toBe(1);
			expect(stats.providers.none).toBe(1);
		},
		{ timeout: 10_000 },
	);

	test(
		"--since filters correctly",
		async () => {
			const dbPath = await setupTempDb();
			const now = Date.now();

			appendLogEntry(
				makeEntry({
					decision: "allow",
					provider: "p1",
					timestamp: now - 7_200_000,
				}),
			);
			appendLogEntry(
				makeEntry({
					decision: "deny",
					provider: "p2",
					timestamp: now - 1_800_000,
				}),
			);
			appendLogEntry(
				makeEntry({
					decision: "allow",
					provider: "p3",
					timestamp: now,
				}),
			);
			resetDbInstance();

			const result = await runCli("stats", ["--json", "--since", "1h"], {
				env: isolatedEnv({ TYR_DB_PATH: dbPath }),
			});
			expect(result.exitCode).toBe(0);
			const stats = JSON.parse(result.stdout.trim());

			// Only the last 2 entries (within 1h)
			expect(stats.total).toBe(2);
			expect(stats.decisions.allow).toBe(1);
			expect(stats.decisions.deny).toBe(1);
		},
		{ timeout: 10_000 },
	);

	test(
		"human-readable output shows all sections",
		async () => {
			const dbPath = await setupTempDb();
			appendLogEntry(
				makeEntry({ decision: "allow", provider: "chained-commands" }),
			);
			resetDbInstance();

			const result = await runCli("stats", [], {
				env: isolatedEnv({ TYR_DB_PATH: dbPath }),
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Permission Check Statistics");
			expect(result.stdout).toContain("Total checks: 1");
			expect(result.stdout).toContain("Decisions:");
			expect(result.stdout).toContain("Cache:");
			expect(result.stdout).toContain("Providers:");
			expect(result.stdout).toContain("Auto-approvals");
		},
		{ timeout: 10_000 },
	);

	test(
		"rejects invalid --since value",
		async () => {
			const dbPath = await setupTempDb();
			const result = await runCli("stats", ["--since", "bogus"], {
				env: isolatedEnv({ TYR_DB_PATH: dbPath }),
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Invalid --since");
		},
		{ timeout: 10_000 },
	);
});
