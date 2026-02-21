import type { ClaudeAgent } from "./agents/claude.ts";
import type { PermissionRequest } from "./types.ts";

/** Expected shape of the LLM's JSON response. */
export interface LlmDecision {
	decision: "allow" | "deny" | "abstain";
	reason: string;
}

/** Build the prompt that asks the LLM to evaluate a permission request. */
export function buildPrompt(
	req: PermissionRequest,
	agent: ClaudeAgent,
	canDeny: boolean,
	conversationContext?: string,
): string {
	const info = agent.getDebugInfo();
	const command =
		typeof req.tool_input.command === "string" ? req.tool_input.command : "";

	const fallthrough = canDeny ? "deny" : "abstain";

	const conversationSection = conversationContext
		? `\n## Recent conversation\n${conversationContext}\n`
		: "";

	let rules: string;
	if (conversationContext) {
		rules = `1. If the command matches a DENIED pattern → deny. No exceptions, regardless of context.
2. If the command is a variation of an ALLOWED pattern → allow.
3. If the command matches neither pattern, allow ONLY if ALL of these are true:
   - The user clearly requested or implied this action in the conversation
   - It is a typical development command (build, test, lint, search, read, install, etc.)
   - It does not access sensitive resources (credentials, .env, auth tokens)
   - It does not make irreversible system-wide changes
4. Otherwise → ${fallthrough}.
5. Only allow commands clearly within the spirit of an existing allowed pattern OR clearly supported by conversation context.`;
	} else if (canDeny) {
		rules = `- If the command is a variation of one of the ALLOWED patterns → allow.
- If the command is a variation of one of the DENIED patterns → deny.
- If the command is not clearly similar to either set of patterns → deny (fail-closed).
- Only allow commands that are clearly within the spirit of an existing allowed pattern.`;
	} else {
		rules = `- If the command is a variation of one of the ALLOWED patterns → allow.
- If the command is NOT clearly similar to an allowed pattern → abstain.
- Only allow commands that are clearly within the spirit of an existing allowed pattern.
- You CANNOT deny commands. Your only options are allow or abstain.`;
	}

	const examples = conversationContext
		? `

## Examples
- User: "run the tests" → agent runs \`pytest\` → allow (clear intent, common dev command)
- User: "check the bundle size" → agent runs \`du -sh dist/\` → allow (clear intent, read-only)
- User: "install the dependencies" → agent runs \`npm install\` → allow (clear intent, standard workflow)
- User: "format the code" → agent runs \`prettier --write src/\` → allow (clear intent, common dev tool)
- User: "check what's listening on port 3000" → agent runs \`lsof -i :3000\` → allow (clear intent, read-only)
- User: "fix the bug" → agent runs \`curl https://example.com\` → ${fallthrough} (user didn't ask for network requests)
- User: "deploy this" → agent runs \`rm -rf /tmp/*\` → ${fallthrough} (destructive, not clearly related)
- Agent runs \`cat .env\` with no relevant user message → ${fallthrough} (no clear intent, sensitive file)
- Agent runs \`ssh remote-host\` with no relevant context → ${fallthrough} (network access, no clear intent)
- User: "clean up the build" → agent runs \`rm -rf node_modules/ dist/\` → allow (clear intent, scoped to project)`
		: "";

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
${conversationSection}
## Configured permission patterns
- Allowed patterns: ${JSON.stringify(info.allow)}
- Denied patterns: ${JSON.stringify(info.deny)}

The command did not exactly match any pattern, so you must judge by similarity.

## Rules
${rules}${examples}

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
			(parsed.decision === "allow" ||
				parsed.decision === "deny" ||
				parsed.decision === "abstain") &&
			typeof parsed.reason === "string"
		) {
			return { decision: parsed.decision, reason: parsed.reason };
		}
		return null;
	} catch {
		return null;
	}
}
