import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDbInstance } from "../db.ts";
import { readLogEntries } from "../log.ts";
import type { HookResponse } from "../types.ts";
import {
	makePermissionRequest,
	runCli,
	runJudge,
	saveEnv,
	writeProjectSettings,
} from "./helpers/index.ts";

const restoreDbEnv = saveEnv("TYR_DB_PATH");

let tempDir: string;

/** Env vars that isolate the subprocess from the host's real settings. */
function isolatedEnv(
	projectDir: string,
	extras: Record<string, string> = {},
): Record<string, string> {
	return {
		CLAUDE_CONFIG_DIR: join(projectDir, "empty-user-config"),
		TYR_CONFIG_FILE: join(projectDir, "tyr-config.json"),
		...extras,
	};
}

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-sqlite-e2e-"));
});

afterEach(async () => {
	resetDbInstance();
	restoreDbEnv();
	await rm(tempDir, { recursive: true, force: true });
});

describe("config change invalidates cache", () => {
	test(
		"changing Claude settings causes cache miss on same command",
		async () => {
			const dbPath = join(tempDir, "tyr.db");

			// Initial settings: allow git *
			await writeProjectSettings(tempDir, {
				permissions: { allow: ["Bash(git *)"] },
			});

			const req = makePermissionRequest({
				cwd: tempDir,
				command: "git status",
			});
			const stdin = JSON.stringify(req);

			const env = isolatedEnv(tempDir, { TYR_DB_PATH: dbPath });

			// First run: cache miss, result logged with cached=0
			const r1 = await runJudge(stdin, {
				args: ["--cache-checks"],
				env,
			});
			expect(r1.exitCode).toBe(0);
			const resp1 = JSON.parse(r1.stdout) as HookResponse;
			expect(resp1.hookSpecificOutput.decision.behavior).toBe("allow");

			// Second run: cache hit, logged with cached=1
			const r2 = await runJudge(stdin, {
				args: ["--cache-checks"],
				env,
			});
			expect(r2.exitCode).toBe(0);

			// Change Claude settings (add a new deny rule)
			await writeProjectSettings(tempDir, {
				permissions: {
					allow: ["Bash(git *)"],
					deny: ["Bash(git push *)"],
				},
			});

			// Third run: config changed → cache miss → logged with cached=0
			const r3 = await runJudge(stdin, {
				args: ["--cache-checks"],
				env,
			});
			expect(r3.exitCode).toBe(0);

			// Verify log entries: first=cached:0, second=cached:1, third=cached:0
			process.env.TYR_DB_PATH = dbPath;
			const entries = readLogEntries();
			expect(entries).toHaveLength(3);
			expect(entries[0]?.cached).toBe(0);
			expect(entries[1]?.cached).toBe(1);
			expect(entries[2]?.cached).toBe(0);
		},
		{ timeout: 20_000 },
	);
});

describe("tyr stats after judge sequence", () => {
	test(
		"stats reflect correct counts from judge decisions",
		async () => {
			const dbPath = join(tempDir, "tyr.db");
			const env = isolatedEnv(tempDir, { TYR_DB_PATH: dbPath });

			await writeProjectSettings(tempDir, {
				permissions: {
					allow: ["Bash(git *)"],
					deny: ["Bash(rm *)"],
				},
			});

			// Run 3 allow (different commands to avoid dedup), 1 deny, 1 abstain
			for (const cmd of ["git status", "git diff", "git log"]) {
				const req = makePermissionRequest({
					cwd: tempDir,
					command: cmd,
				});
				await runJudge(JSON.stringify(req), { env });
			}

			const denyReq = makePermissionRequest({
				cwd: tempDir,
				command: "rm -rf /",
			});
			await runJudge(JSON.stringify(denyReq), { env });

			const unknownReq = makePermissionRequest({
				cwd: tempDir,
				command: "curl https://example.com",
			});
			await runJudge(JSON.stringify(unknownReq), { env });

			// Verify stats
			const result = await runCli("stats", ["--json"], {
				env: { TYR_DB_PATH: dbPath },
			});
			expect(result.exitCode).toBe(0);
			const stats = JSON.parse(result.stdout.trim());
			expect(stats.total).toBe(5);
			expect(stats.decisions.allow).toBe(3);
			expect(stats.decisions.deny).toBe(1);
			expect(stats.decisions.abstain).toBe(1);
		},
		{ timeout: 30_000 },
	);
});

describe("tyr suggest after judge sequence", () => {
	test(
		"suggest recommends frequently approved commands",
		async () => {
			const dbPath = join(tempDir, "tyr.db");
			const configDir = join(tempDir, "claude-config");
			const env = isolatedEnv(tempDir, {
				TYR_DB_PATH: dbPath,
				CLAUDE_CONFIG_DIR: configDir,
			});

			// No allow rules in settings (so suggest can recommend them)
			await writeProjectSettings(tempDir, {
				permissions: {},
			});
			await writeFile(
				join(tempDir, "tyr-config.json"),
				JSON.stringify({ failOpen: true }),
			);

			// Run "bun test" 6 times (failOpen converts abstain→allow)
			for (let i = 0; i < 6; i++) {
				const req = makePermissionRequest({
					cwd: tempDir,
					command: "bun test",
				});
				await runJudge(JSON.stringify(req), { env });
			}

			// Run suggest against the same DB
			const result = await runCli("suggest", ["--json", "--min-count", "5"], {
				env: { TYR_DB_PATH: dbPath, CLAUDE_CONFIG_DIR: configDir },
			});
			expect(result.exitCode).toBe(0);
			const suggestions = JSON.parse(result.stdout.trim());
			expect(suggestions.length).toBeGreaterThanOrEqual(1);

			const bunTest = suggestions.find(
				(s: { command: string }) => s.command === "bun test",
			);
			expect(bunTest).toBeDefined();
			expect(bunTest.count).toBe(6);
			expect(bunTest.rule).toBe("Bash(bun test)");
		},
		{ timeout: 30_000 },
	);
});

describe("corrupt database handling", () => {
	test(
		"judge handles corrupt DB gracefully (still returns decision)",
		async () => {
			const dbPath = join(tempDir, "tyr.db");

			// Create a corrupt DB file
			await writeFile(dbPath, "this is not a valid sqlite database");

			await writeProjectSettings(tempDir, {
				permissions: { allow: ["Bash(git *)"] },
			});

			const req = makePermissionRequest({
				cwd: tempDir,
				command: "git status",
			});

			const result = await runJudge(JSON.stringify(req), {
				env: isolatedEnv(tempDir, { TYR_DB_PATH: dbPath }),
			});

			// Judge should still succeed (errors are caught internally)
			// It may or may not produce allow depending on whether providers run
			// The key assertion is that it doesn't crash with a non-zero exit code
			expect(result.exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"stats handles corrupt DB with error",
		async () => {
			const dbPath = join(tempDir, "tyr.db");
			await writeFile(dbPath, "not a valid sqlite database");

			const result = await runCli("stats", [], {
				env: { TYR_DB_PATH: dbPath },
			});

			// Stats will fail because it can't open the DB
			expect(result.exitCode).not.toBe(0);
		},
		{ timeout: 10_000 },
	);
});
