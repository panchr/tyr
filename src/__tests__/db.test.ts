import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CURRENT_SCHEMA_VERSION,
	closeDb,
	getDb,
	getDbPath,
	migrations,
	resetDbInstance,
	runMigrations,
} from "../db.ts";
import { saveEnv } from "./helpers/index.ts";

let tempDir: string;
const restoreEnv = saveEnv("TYR_DB_PATH");

afterEach(async () => {
	resetDbInstance();
	restoreEnv();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = "";
	}
});

async function setupTempDb(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-db-test-"));
	const dbPath = join(tempDir, "tyr.db");
	process.env.TYR_DB_PATH = dbPath;
	return dbPath;
}

describe("db", () => {
	test("getDbPath respects TYR_DB_PATH env var", async () => {
		const dbPath = await setupTempDb();
		expect(getDbPath()).toBe(dbPath);
	});

	test("getDb creates database file", async () => {
		await setupTempDb();
		const db = getDb();
		expect(db).toBeInstanceOf(Database);
	});

	test("getDb returns singleton", async () => {
		await setupTempDb();
		const db1 = getDb();
		const db2 = getDb();
		expect(db1).toBe(db2);
	});

	test("WAL mode is active", async () => {
		await setupTempDb();
		const db = getDb();
		const row = db.query("PRAGMA journal_mode").get() as {
			journal_mode: string;
		};
		expect(row.journal_mode).toBe("wal");
	});

	test("busy_timeout is set", async () => {
		await setupTempDb();
		const db = getDb();
		const row = db.query("PRAGMA busy_timeout").get() as { timeout: number };
		expect(row.timeout).toBe(5000);
	});

	test("schema version is set in _meta", async () => {
		await setupTempDb();
		const db = getDb();
		const row = db
			.query("SELECT value FROM _meta WHERE key = 'schema_version'")
			.get() as {
			value: string;
		};
		expect(Number(row.value)).toBe(CURRENT_SCHEMA_VERSION);
	});

	test("all expected tables exist", async () => {
		await setupTempDb();
		const db = getDb();
		const tables = db
			.query(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all() as { name: string }[];
		const names = tables.map((t) => t.name);
		expect(names).toContain("_meta");
		expect(names).toContain("logs");
		expect(names).toContain("llm_logs");
		expect(names).toContain("cache");
	});

	test("expected indexes exist", async () => {
		await setupTempDb();
		const db = getDb();
		const indexes = db
			.query(
				"SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all() as { name: string }[];
		const names = indexes.map((i) => i.name);
		expect(names).toContain("idx_logs_timestamp");
		expect(names).toContain("idx_logs_session");
		expect(names).toContain("idx_logs_suggest");
		expect(names).toContain("idx_llm_logs_log_id");
	});

	test("logs table accepts valid insert", async () => {
		await setupTempDb();
		const db = getDb();
		db.query(
			`INSERT INTO logs (timestamp, session_id, cwd, tool_name, tool_input, input, decision, provider, duration_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			Date.now(),
			"sess-1",
			"/tmp",
			"Bash",
			"echo hi",
			'{"command":"echo hi"}',
			"allow",
			"chained-commands",
			5,
		);

		const row = db.query("SELECT COUNT(*) as count FROM logs").get() as {
			count: number;
		};
		expect(row.count).toBe(1);
	});

	test("logs decision check constraint rejects invalid values", async () => {
		await setupTempDb();
		const db = getDb();
		expect(() => {
			db.query(
				`INSERT INTO logs (timestamp, session_id, cwd, tool_name, tool_input, input, decision, provider, duration_ms)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				Date.now(),
				"sess-1",
				"/tmp",
				"Bash",
				"echo hi",
				"{}",
				"invalid",
				null,
				5,
			);
		}).toThrow();
	});

	test("cache table accepts valid insert", async () => {
		await setupTempDb();
		const db = getDb();
		db.query(
			`INSERT INTO cache (tool_name, tool_input, cwd, decision, provider, config_hash, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			"Bash",
			"echo hi",
			"/tmp",
			"allow",
			"chained-commands",
			"abc123",
			Date.now(),
		);

		const row = db.query("SELECT COUNT(*) as count FROM cache").get() as {
			count: number;
		};
		expect(row.count).toBe(1);
	});

	test("cache primary key prevents duplicates", async () => {
		await setupTempDb();
		const db = getDb();
		const insert = `INSERT INTO cache (tool_name, tool_input, cwd, decision, provider, config_hash, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`;
		db.query(insert).run(
			"Bash",
			"echo hi",
			"/tmp",
			"allow",
			"chained-commands",
			"abc123",
			Date.now(),
		);
		expect(() => {
			db.query(insert).run(
				"Bash",
				"echo hi",
				"/tmp",
				"deny",
				"llm",
				"abc123",
				Date.now(),
			);
		}).toThrow();
	});

	test("llm_logs table with FK to logs", async () => {
		await setupTempDb();
		const db = getDb();
		db.query(
			`INSERT INTO logs (timestamp, session_id, cwd, tool_name, tool_input, input, decision, provider, duration_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			Date.now(),
			"sess-1",
			"/tmp",
			"Bash",
			"echo hi",
			"{}",
			"allow",
			"llm",
			100,
		);

		const logRow = db
			.query("SELECT id FROM logs WHERE session_id = 'sess-1'")
			.get() as { id: number };

		db.query(
			"INSERT INTO llm_logs (log_id, prompt, model) VALUES (?, ?, ?)",
		).run(logRow.id, "Is this safe?", "haiku");

		const llmRow = db
			.query("SELECT * FROM llm_logs WHERE log_id = ?")
			.get(logRow.id) as {
			prompt: string;
			model: string;
		};
		expect(llmRow.prompt).toBe("Is this safe?");
		expect(llmRow.model).toBe("haiku");
	});

	test("closeDb can be called multiple times safely", async () => {
		await setupTempDb();
		getDb();
		closeDb();
		closeDb(); // should not throw
	});

	test("version mismatch (too old) emits actionable error", async () => {
		const dbPath = await setupTempDb();

		// Create a DB with an old version
		const db = new Database(dbPath);
		db.run(
			"CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);
		db.query(
			"INSERT INTO _meta (key, value) VALUES ('schema_version', '0')",
		).run();
		db.close();

		expect(() => getDb()).toThrow("tyr db migrate");
	});

	test("version mismatch (too new) emits actionable error", async () => {
		const dbPath = await setupTempDb();

		// Create a DB with a future version
		const db = new Database(dbPath);
		db.run(
			"CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);
		db.query(
			"INSERT INTO _meta (key, value) VALUES ('schema_version', '999')",
		).run();
		db.close();

		expect(() => getDb()).toThrow("Upgrade tyr");
	});

	test("foreign key enforcement rejects invalid log_id in llm_logs", async () => {
		await setupTempDb();
		const db = getDb();
		expect(() => {
			db.query(
				"INSERT INTO llm_logs (log_id, prompt, model) VALUES (?, ?, ?)",
			).run(99999, "test prompt", "haiku");
		}).toThrow();
	});

	test("re-opening existing DB skips schema creation", async () => {
		const dbPath = await setupTempDb();
		getDb();
		resetDbInstance();

		// Re-open the same DB — should work without error
		process.env.TYR_DB_PATH = dbPath;
		const db = getDb();
		expect(db).toBeInstanceOf(Database);
	});

	test("creates parent directories if they don't exist", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-db-test-"));
		const nested = join(tempDir, "nested", "dir", "tyr.db");
		process.env.TYR_DB_PATH = nested;

		const db = getDb();
		expect(db).toBeInstanceOf(Database);
	});
});

describe("runMigrations", () => {
	test("no-op when already at current version", async () => {
		await setupTempDb();
		getDb();
		resetDbInstance();

		const raw = new Database(getDbPath());
		const result = runMigrations(raw);
		expect(result.applied).toBe(0);
		expect(result.fromVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);
		raw.close();
	});

	test("throws on uninitialized database (no _meta)", async () => {
		const dbPath = await setupTempDb();
		const raw = new Database(dbPath);
		expect(() => runMigrations(raw)).toThrow("no _meta table");
		raw.close();
	});

	test("throws on missing schema_version", async () => {
		const dbPath = await setupTempDb();
		const raw = new Database(dbPath);
		raw.run(
			"CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);
		expect(() => runMigrations(raw)).toThrow("missing schema_version");
		raw.close();
	});

	test("throws on future version", async () => {
		const dbPath = await setupTempDb();
		const raw = new Database(dbPath);
		raw.run(
			"CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);
		raw
			.query("INSERT INTO _meta (key, value) VALUES ('schema_version', '999')")
			.run();
		expect(() => runMigrations(raw)).toThrow("Upgrade tyr");
		raw.close();
	});

	test("migrations array length matches CURRENT_SCHEMA_VERSION - 1", () => {
		expect(migrations.length).toBe(CURRENT_SCHEMA_VERSION - 1);
	});
});
