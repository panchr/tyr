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

export const ClaudeConfigSchema = z.object({
	/** Model identifier passed to the Claude CLI. */
	model: z.string().default("haiku"),
	/** Request timeout in seconds. */
	timeout: z.number().default(10),
	/** Whether the provider can deny requests. When false, it can only allow or abstain. */
	canDeny: z.boolean().default(false),
});

export type ClaudeConfig = z.infer<typeof ClaudeConfigSchema>;

export const OpenRouterConfigSchema = z.object({
	/** Model identifier passed to the OpenRouter API. */
	model: z.string().default("anthropic/claude-3.5-haiku"),
	/** OpenRouter API endpoint. */
	endpoint: z.string().default("https://openrouter.ai/api/v1"),
	/** Request timeout in seconds. */
	timeout: z.number().default(10),
	/** Whether the provider can deny requests. When false, it can only allow or abstain. */
	canDeny: z.boolean().default(false),
});

export type OpenRouterConfig = z.infer<typeof OpenRouterConfigSchema>;

/** Valid provider names for the pipeline. */
export const PROVIDER_NAMES = [
	"cache",
	"chained-commands",
	"claude",
	"openrouter",
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const TyrConfigSchema = z.object({
	/** Ordered list of providers to run in the pipeline. */
	providers: z.array(z.enum(PROVIDER_NAMES)).default(["chained-commands"]),
	/** If true, approve requests when tyr encounters an error. Default: false (fail-closed). */
	failOpen: z.boolean().default(false),
	/** Claude CLI provider configuration. */
	claude: ClaudeConfigSchema.default(ClaudeConfigSchema.parse({})),
	/** OpenRouter API provider configuration. */
	openrouter: OpenRouterConfigSchema.default(OpenRouterConfigSchema.parse({})),
	/** Include recent conversation messages in LLM judge prompts for better context. */
	conversationContext: z.boolean().default(false),
	/** Include LLM prompt and parameters in log entries for debugging. */
	verboseLog: z.boolean().default(false),
	/** Maximum age of log entries. Entries older than this are pruned on the next tyr invocation.
	 *  Use relative duration syntax: "30d", "12h", "0" to disable. Default: "30d". */
	logRetention: z
		.string()
		.default("30d")
		.refine((v) => v === "0" || /^\d+[smhd]$/.test(v), {
			message: "Must be '0' or a duration like '30d', '12h', '45m', '60s'",
		}),
});

export type TyrConfig = z.infer<typeof TyrConfigSchema>;

export const DEFAULT_TYR_CONFIG: TyrConfig = TyrConfigSchema.parse({});

/** Return the ordered provider list from config. */
export function resolveProviders(config: TyrConfig): ProviderName[] {
	return config.providers;
}
