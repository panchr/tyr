import type { ClaudeAgent } from "../agents/claude.ts";
import type {
	PermissionRequest,
	PermissionResult,
	Provider,
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

	return `You are a security reviewer for a software development environment.

A coding assistant is requesting permission to run a shell command. Your job is to evaluate whether the command is safe and appropriate.

## Context
- Working directory: ${req.cwd}
- Tool: ${req.tool_name}
- Command: ${command}

## Already configured permissions
- Allowed patterns: ${JSON.stringify(info.allow)}
- Denied patterns: ${JSON.stringify(info.deny)}

The command did not match any of the above patterns, so you must make a judgment call.

## Guidelines
- ALLOW commands that are clearly safe development operations (building, testing, linting, reading files, navigating directories, etc.)
- DENY commands that could be destructive, exfiltrate data, modify system configuration, access sensitive files outside the project, or execute unknown/suspicious binaries.
- When in doubt, DENY.

Respond with ONLY a JSON object in this exact format, no other text:
{"decision": "allow", "reason": "brief explanation"}
or
{"decision": "deny", "reason": "brief explanation"}`;
}

const DEFAULT_TIMEOUT_MS = 30_000;

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

	constructor(
		private agent: ClaudeAgent,
		private timeoutMs: number = DEFAULT_TIMEOUT_MS,
	) {}

	async checkPermission(req: PermissionRequest): Promise<PermissionResult> {
		if (req.tool_name !== "Bash") return "abstain";

		const command = req.tool_input.command;
		if (typeof command !== "string" || command.trim() === "") return "abstain";

		const prompt = buildPrompt(req, this.agent);

		// Clear CLAUDECODE env var so claude -p doesn't refuse to run
		// inside a Claude Code session (tyr is invoked as a hook).
		const env: Record<string, string | undefined> = {
			...process.env,
			CLAUDECODE: undefined,
		};

		const proc = Bun.spawn(["claude", "-p", "--output-format", "text"], {
			stdin: new Response(prompt).body,
			stdout: "pipe",
			stderr: "pipe",
			env,
		});

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

		if (result.timedOut || result.exitCode !== 0) {
			return "abstain";
		}

		const decision = parseLlmResponse(result.stdout);
		if (!decision) return "abstain";

		return decision.decision;
	}
}
