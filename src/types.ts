import { z } from "zod/v4";

// -- Hook interface types (Claude Code PermissionRequest) --

/** Schema for the JSON payload Claude Code sends to hooks on PermissionRequest events. */
export const PermissionRequestSchema = z.object({
	session_id: z.string(),
	transcript_path: z.string(),
	cwd: z.string(),
	permission_mode: z.string(),
	hook_event_name: z.literal("PermissionRequest"),
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()),
});

export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

/** A provider's verdict on a permission request. */
export type PermissionResult = "allow" | "deny" | "abstain";

/** Extended result from a provider, carrying an optional reason. */
export interface ProviderResult {
	decision: PermissionResult;
	reason?: string;
}

/** The JSON structure tyr writes to stdout to communicate a decision back to Claude. */
export interface HookResponse {
	hookSpecificOutput: {
		hookEventName: "PermissionRequest";
		decision: {
			behavior: "allow" | "deny";
			message?: string;
		};
	};
}

// -- Provider interface --

/** A strategy for evaluating permission requests. */
export interface Provider {
	readonly name: string;
	checkPermission(req: PermissionRequest): Promise<ProviderResult>;
}

// -- Agent config interface --

/** An agent's permission rules, read from its configuration files. */
export interface AgentConfig {
	/** Glob/regex patterns that are explicitly allowed. */
	allowPatterns: string[];
	/** Glob/regex patterns that are explicitly denied. */
	denyPatterns: string[];
}

// -- Tyr's own config --

export interface TyrConfig {
	/** Allow the chained-commands provider. */
	allowChainedCommands: boolean;
	/** Allow LLM-based permission checks. */
	allowPromptChecks: boolean;
	/** Cache provider results (Phase 3+). */
	cacheChecks: boolean;
	/** If true, approve requests when tyr encounters an error. Default: false (fail-closed). */
	failOpen: boolean;
	/** LLM provider backend: 'claude' (local CLI) or 'openrouter' (API). */
	llmProvider: string;
	/** Model identifier passed to the LLM provider. */
	llmModel: string;
	/** API endpoint (only used when llmProvider is 'openrouter'). */
	llmEndpoint: string;
	/** LLM request timeout in seconds. */
	llmTimeout: number;
}

export const DEFAULT_TYR_CONFIG: TyrConfig = {
	allowChainedCommands: true,
	allowPromptChecks: false,
	cacheChecks: false,
	failOpen: false,
	llmProvider: "claude",
	llmModel: "haiku",
	llmEndpoint: "https://openrouter.ai/api/v1",
	llmTimeout: 10,
};
