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

// -- Suggestion generalization --

/** A generalized suggestion produced by the LLM. */
export interface GeneralizedSuggestion {
	pattern: string;
	count: number;
	commands: string[];
}

/** Build a prompt asking the LLM to generalize frequently-approved commands into glob patterns. */
export function buildGeneralizePrompt(
	commands: { command: string; count: number }[],
): string {
	const commandList = commands
		.map((c) => `- \`${c.command}\` (approved ${c.count} times)`)
		.join("\n");

	return `You are a shell command pattern generator for a permission system that uses glob patterns (\`*\` matches any sequence of characters).

Below is a list of shell commands that a user manually approved multiple times. Your job is to generalize them into broad glob patterns.

## Commands
${commandList}

## Rules
- Aggressively group commands that share the same base tool/subcommand into a single glob pattern.
- Use \`*\` to match variable parts. A single \`*\` can replace multiple arguments (e.g., \`git diff *\` covers \`git diff --staged src/foo.ts\`).
- Prefer broader patterns. For example, \`git diff *\` is better than listing \`git diff src/foo.ts\` and \`git diff src/bar.ts\` separately.
- Even a single command should get a wildcard if it has variable arguments (e.g., \`cat src/foo.ts\` → \`cat *\`).
- Do NOT generalize commands that differ in their base operation (e.g., don't merge \`git diff\` and \`git push\` into \`git *\`).
- A pattern's count is the sum of counts of all commands it covers.
- Sort results by count descending (highest first).

Respond with ONLY a JSON array, no other text:
[{"pattern": "npm run *", "count": 20, "commands": ["npm run test", "npm run build"]}]`;
}

/** Parse the LLM's generalization response. Returns null on invalid output. */
export function parseGeneralizeResponse(
	stdout: string,
): GeneralizedSuggestion[] | null {
	const trimmed = stdout.trim();
	if (!trimmed) return null;

	const jsonStr = trimmed
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();

	try {
		const parsed = JSON.parse(jsonStr);
		if (!Array.isArray(parsed)) return null;

		const results: GeneralizedSuggestion[] = [];
		for (const item of parsed) {
			if (
				typeof item.pattern === "string" &&
				typeof item.count === "number" &&
				Array.isArray(item.commands) &&
				item.commands.every((c: unknown) => typeof c === "string")
			) {
				results.push({
					pattern: item.pattern,
					count: item.count,
					commands: item.commands as string[],
				});
			}
		}
		return results.length > 0 ? results : null;
	} catch {
		return null;
	}
}
