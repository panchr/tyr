import type { ClaudeAgent } from "../agents/claude.ts";
import type {
	PermissionRequest,
	Provider,
	ProviderResult,
	TyrConfig,
} from "../types.ts";

/** Expected shape of the LLM's JSON response. */
interface LlmDecision {
	decision: "allow" | "deny";
	reason: string;
}

/** Build the prompt that asks the LLM to evaluate a permission request. */
export function buildPrompt(
	req: PermissionRequest,
	agent: ClaudeAgent,
): string {
	const info = agent.getDebugInfo();
	const command =
		typeof req.tool_input.command === "string" ? req.tool_input.command : "";

	return `You are a pattern-matching permission checker.

A coding assistant is requesting permission to run a shell command. Your job is to decide whether this command is similar to an already-allowed pattern or similar to an already-denied pattern.

## Context
- Working directory: ${req.cwd}
- Tool: ${req.tool_name}
- Command: ${command}

## Configured permission patterns
- Allowed patterns: ${JSON.stringify(info.allow)}
- Denied patterns: ${JSON.stringify(info.deny)}

The command did not exactly match any pattern, so you must judge by similarity.

## Rules
- If the command is a variation of one of the ALLOWED patterns → allow.
- If the command is a variation of one of the DENIED patterns → deny.
- If the command is not clearly similar to either set of patterns → deny (fail-closed).
- Only allow commands that are clearly within the spirit of an existing allowed pattern.

Respond with ONLY a JSON object in this exact format, no other text:
{"decision": "allow", "reason": "brief explanation"}
or
{"decision": "deny", "reason": "brief explanation"}`;
}

const S_TO_MS = 1000;

/** Parse the LLM's stdout into a decision. Returns null on invalid output. */
export function parseLlmResponse(stdout: string): LlmDecision | null {
	const trimmed = stdout.trim();
	if (!trimmed) return null;

	// The LLM might wrap JSON in markdown code fences
	const jsonStr = trimmed
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();

	try {
		const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
		if (
			(parsed.decision === "allow" || parsed.decision === "deny") &&
			typeof parsed.reason === "string"
		) {
			return parsed as unknown as LlmDecision;
		}
		return null;
	} catch {
		return null;
	}
}

/** Provider that asks an LLM (via `claude -p`) to evaluate permission requests.
 *  Only handles Bash tool requests. Abstains for everything else. */
export class LlmProvider implements Provider {
	readonly name = "llm";

	private timeoutMs: number;
	private model: string;

	constructor(
		private agent: ClaudeAgent,
		config: Pick<TyrConfig, "llmModel" | "llmTimeout">,
		private verbose: boolean = false,
	) {
		this.model = config.llmModel;
		this.timeoutMs = config.llmTimeout * S_TO_MS;
	}

	async checkPermission(req: PermissionRequest): Promise<ProviderResult> {
		if (req.tool_name !== "Bash") return { decision: "abstain" };

		const command = req.tool_input.command;
		if (typeof command !== "string" || command.trim() === "")
			return { decision: "abstain" };

		const prompt = buildPrompt(req, this.agent);

		// Clear CLAUDECODE env var so claude -p doesn't refuse to run
		// inside a Claude Code session (tyr is invoked as a hook).
		const env: Record<string, string | undefined> = {
			...process.env,
			CLAUDECODE: undefined,
		};

		const proc = Bun.spawn(
			["claude", "-p", "--output-format", "text", "--model", this.model],
			{
				stdin: new Response(prompt).body,
				stdout: "pipe",
				stderr: "pipe",
				env,
			},
		);

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
				setTimeout(() => {
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

		return { decision: llmDecision.decision, reason: llmDecision.reason };
	}
}
