import type { PermissionRequest, PermissionResult, Provider } from "./types.ts";

/** Result from running the provider pipeline. */
export interface PipelineResult {
	decision: PermissionResult;
	provider: string | null;
	reason?: string;
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
			if (result.decision === "allow" || result.decision === "deny") {
				return {
					decision: result.decision,
					provider: provider.name,
					reason: result.reason,
				};
			}
		} catch {
			// Provider errors are treated as abstain — fail-through
		}
	}

	return { decision: "abstain", provider: null };
}
