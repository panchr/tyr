import { createHash } from "node:crypto";
import type { ClaudeAgent } from "./agents/claude.ts";
import { getDb } from "./db.ts";
import { extractToolInput } from "./log.ts";
import type { PermissionRequest, TyrConfig } from "./types.ts";

interface CacheHit {
	decision: "allow" | "deny";
	provider: string;
	reason: string | null;
}

/** Compute a config fingerprint covering both Claude's rules and tyr's config. */
export function computeConfigHash(
	agent: ClaudeAgent,
	config: TyrConfig,
): string {
	const info = agent.getDebugInfo();
	const data = JSON.stringify({
		allow: [...info.allow].sort(),
		deny: [...info.deny].sort(),
		allowChainedCommands: config.allowChainedCommands,
		allowPromptChecks: config.allowPromptChecks,
		failOpen: config.failOpen,
		llmProvider: config.llmProvider,
		llmModel: config.llmModel,
		llmCanDeny: config.llmCanDeny,
	});
	return createHash("sha256").update(data).digest("hex");
}

/** Look up a cached decision. Returns null on miss. */
export function checkCache(
	req: PermissionRequest,
	configHash: string,
): CacheHit | null {
	const db = getDb();
	const toolInput = extractToolInput(req.tool_name, req.tool_input);

	const row = db
		.query(
			"SELECT decision, provider, reason FROM cache WHERE tool_name = ? AND tool_input = ? AND cwd = ? AND config_hash = ?",
		)
		.get(req.tool_name, toolInput, req.cwd, configHash) as {
		decision: string;
		provider: string;
		reason: string | null;
	} | null;

	if (!row) return null;

	return {
		decision: row.decision as "allow" | "deny",
		provider: row.provider,
		reason: row.reason,
	};
}

/** Store a definitive decision in the cache. Only allow/deny are cached. */
export function writeCache(
	req: PermissionRequest,
	decision: "allow" | "deny",
	provider: string,
	reason: string | undefined,
	configHash: string,
): void {
	const db = getDb();
	const toolInput = extractToolInput(req.tool_name, req.tool_input);

	db.query(
		`INSERT OR REPLACE INTO cache (tool_name, tool_input, cwd, decision, provider, reason, config_hash, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		req.tool_name,
		toolInput,
		req.cwd,
		decision,
		provider,
		reason ?? null,
		configHash,
		Date.now(),
	);
}
