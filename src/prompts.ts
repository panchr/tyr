import type { ClaudeAgent } from "./agents/claude.ts";
import type { PermissionRequest } from "./types.ts";

/** Expected shape of the LLM's JSON response. */
export interface LlmDecision {
	decision: "allow" | "deny";
	reason: string;
}

/** Build the prompt that asks the LLM to evaluate a permission request. */
export function buildPrompt(
	req: PermissionRequest,
	agent: ClaudeAgent,
	canDeny: boolean,
): string {
	const info = agent.getDebugInfo();
	const command =
		typeof req.tool_input.command === "string" ? req.tool_input.command : "";

	const rules = canDeny
		? `- If the command is a variation of one of the ALLOWED patterns → allow.
- If the command is a variation of one of the DENIED patterns → deny.
- If the command is not clearly similar to either set of patterns → deny (fail-closed).
- Only allow commands that are clearly within the spirit of an existing allowed pattern.`
		: `- If the command is a variation of one of the ALLOWED patterns → allow.
- If the command is NOT clearly similar to an allowed pattern → abstain.
- Only allow commands that are clearly within the spirit of an existing allowed pattern.
- You CANNOT deny commands. Your only options are allow or abstain.`;

	const responseFormat = canDeny
		? `{"decision": "allow", "reason": "brief explanation"}
or
{"decision": "deny", "reason": "brief explanation"}`
		: `{"decision": "allow", "reason": "brief explanation"}
or
{"decision": "abstain", "reason": "brief explanation"}`;

	return `You are a pattern-matching permission checker.

A coding assistant is requesting permission to run a shell command. Your job is to decide whether this command is similar to an already-allowed pattern.

## Context
- Working directory: ${req.cwd}
- Tool: ${req.tool_name}
- Command: ${command}

## Configured permission patterns
- Allowed patterns: ${JSON.stringify(info.allow)}
- Denied patterns: ${JSON.stringify(info.deny)}

The command did not exactly match any pattern, so you must judge by similarity.

## Rules
${rules}

Respond with ONLY a JSON object in this exact format, no other text:
${responseFormat}`;
}

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
			return { decision: parsed.decision, reason: parsed.reason };
		}
		return null;
	} catch {
		return null;
	}
}
