import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION, getDb, resetDbInstance } from "../db.ts";
import { saveEnv } from "./helpers/index.ts";
import { runCli } from "./helpers/subprocess.ts";

let tempDir: string;
let dbPath: string;
const restoreEnv = saveEnv("TYR_DB_PATH");

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-db-migrate-"));
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

describe("tyr db migrate", () => {
	test(
		"reports uninitialized on fresh database",
		async () => {
			const { stdout, exitCode } = await runCli("db", ["migrate"], {
				env: envOverrides(),
			});
			expect(exitCode).toBe(0);
			expect(stdout).toContain("uninitialized");
		},
		{ timeout: 10_000 },
	);

	test(
		"reports already up-to-date on initialized database",
		async () => {
			// Initialize the DB via getDb() first
			process.env.TYR_DB_PATH = dbPath;
			getDb();
			resetDbInstance();

			const { stdout, exitCode } = await runCli("db", ["migrate"], {
				env: envOverrides(),
			});
			expect(exitCode).toBe(0);
			expect(stdout).toContain(`v${CURRENT_SCHEMA_VERSION}`);
			expect(stdout).toContain("Nothing to do");
		},
		{ timeout: 10_000 },
	);

	test(
		"errors on database with missing schema_version",
		async () => {
			const db = new Database(dbPath);
			db.run("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
			db.close();

			const { stderr, exitCode } = await runCli("db", ["migrate"], {
				env: envOverrides(),
			});
			expect(exitCode).toBe(1);
			expect(stderr).toContain("missing schema_version");
		},
		{ timeout: 10_000 },
	);

	test(
		"errors on database with future version",
		async () => {
			const db = new Database(dbPath);
			db.run("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
			db.query(
				"INSERT INTO _meta (key, value) VALUES ('schema_version', '999')",
			).run();
			db.close();

			const { stderr, exitCode } = await runCli("db", ["migrate"], {
				env: envOverrides(),
			});
			expect(exitCode).toBe(1);
			expect(stderr).toContain("Upgrade tyr");
		},
		{ timeout: 10_000 },
	);
});
