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

export default defineCommand({
	meta: {
		name: "db",
		description: "Database management commands",
	},
	subCommands: {
		migrate,
	},
});
