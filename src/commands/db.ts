import { resolve } from "node:path";
import { defineCommand } from "citty";
import {
	CURRENT_SCHEMA_VERSION,
	getDbPath,
	getSchemaVersion,
	hasMetaTable,
	openRawDb,
	runMigrations,
} from "../db.ts";

const migrate = defineCommand({
	meta: {
		name: "migrate",
		description: "Run pending database schema migrations",
	},
	async run() {
		const dbPath = getDbPath();
		const db = openRawDb(dbPath);

		if (!hasMetaTable(db)) {
			console.log(
				"Database is uninitialized. Run any tyr command to create the schema.",
			);
			db.close();
			return;
		}

		const version = getSchemaVersion(db);
		if (version === null) {
			console.error(
				"[tyr] database is missing schema_version. Cannot migrate.",
			);
			db.close();
			process.exit(1);
		}

		if (version === CURRENT_SCHEMA_VERSION) {
			console.log(
				`Database is already at v${CURRENT_SCHEMA_VERSION}. Nothing to do.`,
			);
			db.close();
			return;
		}

		console.log(`Database: ${dbPath}`);
		console.log(`Current version: v${version}`);
		console.log(`Target version:  v${CURRENT_SCHEMA_VERSION}`);

		const result = runMigrations(db);
		console.log(
			`Applied ${result.applied} migration(s): v${result.fromVersion} → v${result.toVersion}`,
		);

		db.close();
	},
});

const rename = defineCommand({
	meta: {
		name: "rename",
		description:
			"Rename a project directory in the database (e.g. after moving a project)",
	},
	args: {
		oldPath: {
			type: "positional",
			description: "Current project directory path",
			required: true,
		},
		newPath: {
			type: "positional",
			description: "New project directory path",
			required: true,
		},
	},
	async run({ args }) {
		const oldPath = resolve(args.oldPath as string);
		const newPath = resolve(args.newPath as string);

		if (oldPath === newPath) {
			console.error("Old and new paths are the same.");
			process.exit(1);
		}

		const db = openRawDb();

		if (!hasMetaTable(db)) {
			console.error("Database is uninitialized. Nothing to rename.");
			db.close();
			process.exit(1);
		}

		const escapedOld = oldPath.replace(/[\\%_]/g, "\\$&");

		const updated = db.transaction(() => {
			let total = 0;
			for (const table of ["logs", "cache"] as const) {
				const result = db
					.query(
						`UPDATE ${table} SET cwd = ? || substr(cwd, length(?) + 1)
						 WHERE cwd = ? OR cwd LIKE ? || '/%' ESCAPE '\\'`,
					)
					.run(newPath, oldPath, oldPath, escapedOld);
				total += result.changes;
			}
			return total;
		})();

		console.log(`Renamed ${oldPath} → ${newPath} (${updated} row(s) updated)`);
		db.close();
	},
});

export default defineCommand({
	meta: {
		name: "db",
		description: "Database management commands",
	},
	subCommands: {
		migrate,
		rename,
	},
});
