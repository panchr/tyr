import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbInstance } from "../db.ts";
import { appendLogEntry } from "../log.ts";
import { saveEnv } from "./helpers/index.ts";
import { runCli } from "./helpers/subprocess.ts";

let tempDir: string;
let dbPath: string;
const restoreEnv = saveEnv("TYR_DB_PATH");

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-db-rename-"));
	dbPath = join(tempDir, "tyr.db");
});

afterEach(async () => {
	resetDbInstance();
	restoreEnv();
	await rm(tempDir, { recursive: true, force: true });
});

function envOverrides(): Record<string, string | undefined> {
	return {
		TYR_DB_PATH: dbPath,
		CLAUDE_CONFIG_DIR: join(tempDir, "empty-config"),
		TYR_CONFIG_FILE: join(tempDir, "tyr-config.json"),
	};
}

function seedDb(): void {
	process.env.TYR_DB_PATH = dbPath;
	const db = getDb();

	// Insert log entries for /projects/old-name and a subpath
	appendLogEntry({
		timestamp: 1000,
		session_id: "s1",
		cwd: "/projects/old-name",
		tool_name: "Bash",
		tool_input: "ls",
		input: "list files",
		decision: "allow",
		provider: "test",
		reason: null,
		duration_ms: 10,
	});
	appendLogEntry({
		timestamp: 2000,
		session_id: "s1",
		cwd: "/projects/old-name/src",
		tool_name: "Bash",
		tool_input: "cat file.ts",
		input: "read file",
		decision: "allow",
		provider: "test",
		reason: null,
		duration_ms: 5,
	});

	// Insert an unrelated entry that should not be touched
	appendLogEntry({
		timestamp: 3000,
		session_id: "s2",
		cwd: "/other/project",
		tool_name: "Bash",
		tool_input: "echo hi",
		input: "echo",
		decision: "allow",
		provider: "test",
		reason: null,
		duration_ms: 1,
	});

	// Insert cache entries
	db.query(
		`INSERT INTO cache (tool_name, tool_input, cwd, decision, provider, reason, config_hash, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run("Bash", "ls", "/projects/old-name", "allow", "test", null, "h1", 1000);
	db.query(
		`INSERT INTO cache (tool_name, tool_input, cwd, decision, provider, reason, config_hash, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		"Bash",
		"cat",
		"/projects/old-name/src",
		"allow",
		"test",
		null,
		"h1",
		2000,
	);

	resetDbInstance();
}

describe("tyr db rename", () => {
	test(
		"renames project path in logs and cache tables",
		async () => {
			seedDb();

			const { stdout, exitCode } = await runCli(
				"db",
				["rename", "/projects/old-name", "/projects/new-name"],
				{ env: envOverrides() },
			);
			expect(exitCode).toBe(0);
			expect(stdout).toContain("/projects/old-name");
			expect(stdout).toContain("/projects/new-name");
			expect(stdout).toContain("4 row(s) updated");

			// Verify the DB contents directly
			process.env.TYR_DB_PATH = dbPath;
			const db = getDb();
			const logs = db.query("SELECT cwd FROM logs ORDER BY id").all() as {
				cwd: string;
			}[];
			expect(logs.map((r) => r.cwd)).toEqual([
				"/projects/new-name",
				"/projects/new-name/src",
				"/other/project",
			]);

			const cache = db
				.query("SELECT cwd FROM cache ORDER BY created_at")
				.all() as { cwd: string }[];
			expect(cache.map((r) => r.cwd)).toEqual([
				"/projects/new-name",
				"/projects/new-name/src",
			]);
		},
		{ timeout: 10_000 },
	);

	test(
		"reports 0 rows when path has no matches",
		async () => {
			seedDb();

			const { stdout, exitCode } = await runCli(
				"db",
				["rename", "/nonexistent/path", "/other/path"],
				{ env: envOverrides() },
			);
			expect(exitCode).toBe(0);
			expect(stdout).toContain("0 row(s) updated");
		},
		{ timeout: 10_000 },
	);

	test(
		"errors when old and new paths are the same",
		async () => {
			const { stderr, exitCode } = await runCli(
				"db",
				["rename", "/projects/foo", "/projects/foo"],
				{ env: envOverrides() },
			);
			expect(exitCode).toBe(1);
			expect(stderr).toContain("same");
		},
		{ timeout: 10_000 },
	);

	test(
		"errors on uninitialized database",
		async () => {
			const { stderr, exitCode } = await runCli(
				"db",
				["rename", "/old", "/new"],
				{ env: envOverrides() },
			);
			expect(exitCode).toBe(1);
			expect(stderr).toContain("uninitialized");
		},
		{ timeout: 10_000 },
	);
});
