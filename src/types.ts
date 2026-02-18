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

// -- Tyr's own config --

export const LlmConfigSchema = z.object({
	/** LLM provider backend: 'claude' (local CLI) or 'openrouter' (API). */
	provider: z.enum(["claude", "openrouter"]).default("claude"),
	/** Model identifier passed to the LLM provider. */
	model: z.string().default("haiku"),
	/** API endpoint (only used when provider is 'openrouter'). */
	endpoint: z.string().default("https://openrouter.ai/api/v1"),
	/** LLM request timeout in seconds. */
	timeout: z.number().default(10),
	/** Whether the LLM provider can deny requests. When false, LLM can only allow or abstain. */
	canDeny: z.boolean().default(false),
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;

export const TyrConfigSchema = z.object({
	/** Allow the chained-commands provider. */
	allowChainedCommands: z.boolean().default(true),
	/** Allow LLM-based permission checks. */
	allowPromptChecks: z.boolean().default(false),
	/** Cache provider results. */
	cacheChecks: z.boolean().default(false),
	/** If true, approve requests when tyr encounters an error. Default: false (fail-closed). */
	failOpen: z.boolean().default(false),
	/** LLM provider configuration. */
	llm: LlmConfigSchema.default(LlmConfigSchema.parse({})),
	/** Include LLM prompt and parameters in log entries for debugging. */
	verboseLog: z.boolean().default(false),
});

export type TyrConfig = z.infer<typeof TyrConfigSchema>;

export const DEFAULT_TYR_CONFIG: TyrConfig = TyrConfigSchema.parse({});
