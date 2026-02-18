import { defineCommand } from "citty";
import { parseTime, rejectUnknownArgs } from "../args.ts";
import { closeDb, getDb } from "../db.ts";

const statsArgs = {
	since: {
		type: "string" as const,
		description:
			"Show stats for entries after timestamp (ISO or relative: 1h, 30m, 7d)",
	},
	json: {
		type: "boolean" as const,
		description: "Output raw JSON",
	},
};

interface DecisionCount {
	decision: string;
	count: number;
}

interface ProviderCount {
	provider: string | null;
	count: number;
}

export default defineCommand({
	meta: {
		name: "stats",
		description: "Show permission check statistics",
	},
	args: statsArgs,
	async run({ args, rawArgs }) {
		rejectUnknownArgs(rawArgs, statsArgs);

		let since: number | undefined;
		if (args.since) {
			const t = parseTime(args.since);
			if (!t) {
				console.error(`Invalid --since value: ${args.since}`);
				process.exit(1);
				return;
			}
			since = t.getTime();
		}

		const db = getDb();
		const conditions: string[] = [];
		const params: number[] = [];

		if (since !== undefined) {
			conditions.push("timestamp >= ?");
			params.push(since);
		}

		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		// Total count
		const totalRow = db
			.query(`SELECT COUNT(*) as count FROM logs ${whereClause}`)
			.get(...params) as { count: number };
		const total = totalRow.count;

		// Decisions by type
		const decisionRows = db
			.query(
				`SELECT decision, COUNT(*) as count FROM logs ${whereClause} GROUP BY decision ORDER BY count DESC`,
			)
			.all(...params) as DecisionCount[];

		// Cache hit rate
		const cacheRow = db
			.query(
				`SELECT SUM(cached) as hits, COUNT(*) as total FROM logs ${whereClause}`,
			)
			.get(...params) as { hits: number | null; total: number };
		const cacheHits = cacheRow.hits ?? 0;
		const cacheRate =
			cacheRow.total > 0 ? (cacheHits / cacheRow.total) * 100 : 0;

		// Provider breakdown
		const providerRows = db
			.query(
				`SELECT provider, COUNT(*) as count FROM logs ${whereClause} GROUP BY provider ORDER BY count DESC`,
			)
			.all(...params) as ProviderCount[];

		// Auto-approvals (allow decisions = effort saved)
		const allowConditions = [...conditions, "decision = 'allow'"];
		const allowWhere = `WHERE ${allowConditions.join(" AND ")}`;
		const allowRow = db
			.query(`SELECT COUNT(*) as count FROM logs ${allowWhere}`)
			.get(...params) as { count: number };

		const stats = {
			total,
			decisions: Object.fromEntries(
				decisionRows.map((r) => [r.decision, r.count]),
			),
			cache: {
				hits: cacheHits,
				rate: Math.round(cacheRate * 10) / 10,
			},
			providers: Object.fromEntries(
				providerRows.map((r) => [r.provider ?? "none", r.count]),
			),
			autoApprovals: allowRow.count,
		};

		if (args.json) {
			console.log(JSON.stringify(stats));
			closeDb();
			return;
		}

		// Human-readable output
		console.log("Permission Check Statistics");
		if (args.since) {
			console.log(`  Period: since ${args.since}`);
		}
		console.log(`  Total checks: ${total}`);
		console.log();

		console.log("Decisions:");
		for (const type of ["allow", "deny", "abstain", "error"]) {
			const count = stats.decisions[type] ?? 0;
			const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
			console.log(
				`  ${type.padEnd(10)} ${String(count).padStart(6)}  (${pct}%)`,
			);
		}
		console.log();

		console.log("Cache:");
		console.log(`  Hit rate: ${stats.cache.rate}% (${cacheHits}/${total})`);
		console.log();

		console.log("Providers:");
		if (providerRows.length === 0) {
			console.log("  (none)");
		} else {
			for (const row of providerRows) {
				const name = row.provider ?? "none";
				console.log(`  ${name.padEnd(20)} ${String(row.count).padStart(6)}`);
			}
		}
		console.log();

		console.log(`Auto-approvals (user effort saved): ${stats.autoApprovals}`);

		closeDb();
	},
});
