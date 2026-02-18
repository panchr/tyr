import type { ClaudeAgent } from "../agents/claude.ts";
import { buildPrompt, parseLlmResponse } from "../prompts.ts";
import type {
	OpenRouterConfig,
	PermissionRequest,
	Provider,
	ProviderResult,
} from "../types.ts";

const S_TO_MS = 1000;

/** Provider that calls OpenRouter's chat completions API to evaluate permission requests.
 *  Only handles Bash tool requests. Abstains for everything else. */
export class OpenRouterProvider implements Provider {
	readonly name = "openrouter";

	private timeoutMs: number;
	private model: string;
	private endpoint: string;
	private canDeny: boolean;

	constructor(
		private agent: ClaudeAgent,
		config: OpenRouterConfig,
		private verbose: boolean = false,
	) {
		this.model = config.model;
		this.timeoutMs = config.timeout * S_TO_MS;
		this.canDeny = config.canDeny;
		this.endpoint = config.endpoint;
	}

	async checkPermission(req: PermissionRequest): Promise<ProviderResult> {
		if (req.tool_name !== "Bash") return { decision: "abstain" };

		const command = req.tool_input.command;
		if (typeof command !== "string" || command.trim() === "")
			return { decision: "abstain" };

		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			console.error(
				"[tyr] openrouter: OPENROUTER_API_KEY not set, skipping LLM check",
			);
			return { decision: "abstain" };
		}

		const prompt = buildPrompt(req, this.agent, this.canDeny);
		const url = `${this.endpoint}/chat/completions`;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);

		let responseText: string;
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.model,
					messages: [{ role: "user", content: prompt }],
					temperature: 0,
					max_tokens: 256,
				}),
				signal: controller.signal,
			});

			if (!res.ok) {
				if (this.verbose) {
					const body = await res.text().catch(() => "<unreadable>");
					console.error(
						`[tyr] openrouter: HTTP ${res.status}: ${body.slice(0, 200)}`,
					);
				}
				return { decision: "abstain" };
			}

			const json = (await res.json()) as {
				choices?: { message?: { content?: string } }[];
			};
			responseText = json.choices?.[0]?.message?.content ?? "";
		} catch (err) {
			if (this.verbose) {
				const label =
					err instanceof DOMException && err.name === "AbortError"
						? "timeout"
						: String(err);
				console.error(`[tyr] openrouter: ${label}`);
			}
			return { decision: "abstain" };
		} finally {
			clearTimeout(timer);
		}

		if (this.verbose) {
			console.error(`[tyr] openrouter response: ${responseText.trim()}`);
		}

		const llmDecision = parseLlmResponse(responseText);
		if (!llmDecision) return { decision: "abstain" };

		// When canDeny is false, convert deny→abstain so the user gets prompted
		if (!this.canDeny && llmDecision.decision === "deny") {
			return { decision: "abstain", reason: llmDecision.reason };
		}

		return { decision: llmDecision.decision, reason: llmDecision.reason };
	}
}
