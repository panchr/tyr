import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Current schema version. Bump when schema changes require migration. */
export const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_DB_DIR = join(homedir(), ".local", "share", "tyr");
const DEFAULT_DB_FILE = join(DEFAULT_DB_DIR, "tyr.db");

export function getDbPath(): string {
	return process.env.TYR_DB_PATH ?? DEFAULT_DB_FILE;
}

let instance: Database | null = null;

const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
)`,
	`CREATE TABLE IF NOT EXISTS logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    session_id  TEXT    NOT NULL,
    cwd         TEXT    NOT NULL,
    tool_name   TEXT    NOT NULL,
    tool_input  TEXT    NOT NULL,
    input       TEXT    NOT NULL,
    decision    TEXT    NOT NULL CHECK (decision IN ('allow','deny','abstain','error')),
    provider    TEXT,
    reason      TEXT,
    duration_ms INTEGER NOT NULL,
    cached      INTEGER NOT NULL DEFAULT 0,
    mode        TEXT    CHECK (mode IN ('shadow','audit') OR mode IS NULL)
)`,
	"CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs (timestamp)",
	"CREATE INDEX IF NOT EXISTS idx_logs_session   ON logs (session_id)",
	"CREATE INDEX IF NOT EXISTS idx_logs_suggest   ON logs (decision, mode, tool_input)",
	`CREATE TABLE IF NOT EXISTS llm_logs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id   INTEGER NOT NULL REFERENCES logs(id),
    prompt   TEXT    NOT NULL,
    model    TEXT    NOT NULL
)`,
	"CREATE INDEX IF NOT EXISTS idx_llm_logs_log_id ON llm_logs (log_id)",
	`CREATE TABLE IF NOT EXISTS cache (
    tool_name   TEXT    NOT NULL,
    tool_input  TEXT    NOT NULL,
    cwd         TEXT    NOT NULL,
    decision    TEXT    NOT NULL CHECK (decision IN ('allow','deny')),
    provider    TEXT    NOT NULL,
    reason      TEXT,
    config_hash TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (tool_name, tool_input, cwd)
)`,
];

function getSchemaVersion(db: Database): number | null {
	const row = db
		.query("SELECT value FROM _meta WHERE key = 'schema_version'")
		.get() as { value: string } | null;
	return row ? Number(row.value) : null;
}

function checkVersion(version: number): void {
	if (version < CURRENT_SCHEMA_VERSION) {
		throw new Error(
			`[tyr] database schema is v${version} but tyr requires v${CURRENT_SCHEMA_VERSION}. Run 'tyr db:migrate' to upgrade.`,
		);
	}
	if (version > CURRENT_SCHEMA_VERSION) {
		throw new Error(
			`[tyr] database schema is v${version} but this tyr only supports up to v${CURRENT_SCHEMA_VERSION}. Upgrade tyr.`,
		);
	}
}

function hasMetaTable(db: Database): boolean {
	const row = db
		.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_meta'")
		.get();
	return row !== null;
}

function initDb(db: Database): void {
	// PRAGMAs must run outside transactions
	const walResult = db.query("PRAGMA journal_mode = WAL").get() as {
		journal_mode: string;
	};
	if (walResult.journal_mode !== "wal") {
		throw new Error(
			`[tyr] failed to enable WAL mode (got ${walResult.journal_mode})`,
		);
	}
	db.run("PRAGMA busy_timeout = 5000");
	db.run("PRAGMA foreign_keys = ON");

	// If _meta exists, this is an existing DB — check version before touching anything
	if (hasMetaTable(db)) {
		const version = getSchemaVersion(db);
		if (version === null) {
			throw new Error(
				"[tyr] database is missing schema_version. Delete the DB or run 'tyr db:migrate'.",
			);
		}
		checkVersion(version);
		return;
	}

	// First-time initialization — create all tables in a transaction
	db.transaction(() => {
		for (const stmt of SCHEMA_STATEMENTS) {
			db.run(stmt);
		}
		db.query("INSERT INTO _meta (key, value) VALUES ('schema_version', ?)").run(
			String(CURRENT_SCHEMA_VERSION),
		);
	})();
}

/** Get (or create) the singleton SQLite database connection. */
export function getDb(): Database {
	if (instance) return instance;

	const dbPath = getDbPath();
	mkdirSync(dirname(dbPath), { recursive: true });

	const db = new Database(dbPath);
	initDb(db);

	instance = db;
	return db;
}

/** Close the singleton connection. Safe to call multiple times. */
export function closeDb(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}

/** Reset the singleton (for tests). Closes the connection first. */
export function resetDbInstance(): void {
	closeDb();
}
