import { checkCache, writeCache } from "../cache.ts";
import type { PermissionRequest, Provider, ProviderResult } from "../types.ts";

/** Provider that checks the decision cache. Sits at the front of the pipeline
 *  so cached results short-circuit more expensive providers.
 *
 *  After the pipeline runs, call `cacheResult()` to store a new result from
 *  a downstream provider. */
export class CacheProvider implements Provider {
	readonly name = "cache";

	constructor(private configHash: string) {}

	async checkPermission(req: PermissionRequest): Promise<ProviderResult> {
		const hit = checkCache(req, this.configHash);
		if (hit) {
			return {
				decision: hit.decision,
				reason: hit.reason ?? undefined,
			};
		}
		return { decision: "abstain" };
	}

	/** Store a definitive result from a downstream provider. */
	cacheResult(
		req: PermissionRequest,
		decision: "allow" | "deny",
		provider: string,
		reason: string | undefined,
	): void {
		writeCache(req, decision, provider, reason, this.configHash);
	}
}
