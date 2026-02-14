import type { PermissionRequest, PermissionResult, Provider } from "./types.ts";

/** Result from running the provider pipeline. */
export interface PipelineResult {
	decision: PermissionResult;
	provider: string | null;
}

/** Run providers in order until one returns a definitive result.
 *  First `allow` or `deny` wins. If all abstain, returns `abstain`. */
export async function runPipeline(
	providers: Provider[],
	req: PermissionRequest,
): Promise<PipelineResult> {
	for (const provider of providers) {
		try {
			const result = await provider.checkPermission(req);
			if (result === "allow" || result === "deny") {
				return { decision: result, provider: provider.name };
			}
		} catch {
			// Provider errors are treated as abstain — fail-through
		}
	}

	return { decision: "abstain", provider: null };
}
