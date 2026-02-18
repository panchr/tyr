import type { ClaudeAgent } from "../agents/claude.ts";
import { buildPrompt, parseLlmResponse } from "../prompts.ts";
import type {
	LlmConfig,
	PermissionRequest,
	Provider,
	ProviderResult,
} from "../types.ts";

export { buildPrompt, parseLlmResponse };

const S_TO_MS = 1000;

/** Provider that asks an LLM (via `claude -p`) to evaluate permission requests.
 *  Only handles Bash tool requests. Abstains for everything else. */
export class LlmProvider implements Provider {
	readonly name = "llm";

	private timeoutMs: number;
	private model: string;
	private canDeny: boolean;

	constructor(
		private agent: ClaudeAgent,
		config: Pick<LlmConfig, "model" | "timeout" | "canDeny">,
		private verbose: boolean = false,
	) {
		this.model = config.model;
		this.timeoutMs = config.timeout * S_TO_MS;
		this.canDeny = config.canDeny;
	}

	async checkPermission(req: PermissionRequest): Promise<ProviderResult> {
		if (req.tool_name !== "Bash") return { decision: "abstain" };

		const command = req.tool_input.command;
		if (typeof command !== "string" || command.trim() === "")
			return { decision: "abstain" };

		const prompt = buildPrompt(req, this.agent, this.canDeny);

		// Clear CLAUDECODE env var so claude -p doesn't refuse to run
		// inside a Claude Code session (tyr is invoked as a hook).
		const env: Record<string, string | undefined> = {
			...process.env,
			CLAUDECODE: undefined,
		};

		const proc = Bun.spawn(
			[
				"claude",
				"-p",
				"--output-format",
				"text",
				"--no-session-persistence",
				"--model",
				this.model,
			],
			{
				stdin: new Response(prompt).body,
				stdout: "pipe",
				stderr: "pipe",
				env,
			},
		);

		let timer: Timer | undefined;
		const result = await Promise.race([
			(async () => {
				const [stdout, stderr] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
				]);
				const exitCode = await proc.exited;
				return { stdout, stderr, exitCode, timedOut: false };
			})(),
			new Promise<{
				stdout: string;
				stderr: string;
				exitCode: number;
				timedOut: boolean;
			}>((resolve) => {
				timer = setTimeout(() => {
					proc.kill();
					resolve({
						stdout: "",
						stderr: "timeout",
						exitCode: -1,
						timedOut: true,
					});
				}, this.timeoutMs);
			}),
		]);
		clearTimeout(timer);

		if (this.verbose) {
			console.error(
				`[tyr] llm: exitCode=${result.exitCode} timedOut=${result.timedOut}`,
			);
			if (result.stdout)
				console.error(`[tyr] llm stdout: ${result.stdout.trim()}`);
			if (result.stderr)
				console.error(`[tyr] llm stderr: ${result.stderr.trim()}`);
		}

		if (result.timedOut || result.exitCode !== 0) {
			return { decision: "abstain" };
		}

		const llmDecision = parseLlmResponse(result.stdout);
		if (!llmDecision) return { decision: "abstain" };

		// When canDeny is false, convert deny→abstain so the user gets prompted
		if (!this.canDeny && llmDecision.decision === "deny") {
			return { decision: "abstain", reason: llmDecision.reason };
		}

		return { decision: llmDecision.decision, reason: llmDecision.reason };
	}
}
