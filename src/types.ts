// -- Hook interface types (Claude Code PermissionRequest) --

/** The JSON payload Claude Code sends to hooks on PermissionRequest events. */
export interface PermissionRequest {
	session_id: string;
	transcript_path: string;
	cwd: string;
	permission_mode: string;
	hook_event_name: "PermissionRequest";
	tool_name: string;
	tool_input: Record<string, unknown>;
}

/** A provider's verdict on a permission request. */
export type PermissionResult = "allow" | "deny" | "abstain";

/** The JSON structure tyr writes to stdout to communicate a decision back to Claude. */
export interface HookResponse {
	hookSpecificOutput: {
		hookEventName: "PermissionRequest";
		decision: {
			behavior: "allow" | "deny";
		};
	};
}

// -- Provider interface --

/** A strategy for evaluating permission requests. */
export interface Provider {
	readonly name: string;
	checkPermission(req: PermissionRequest): Promise<PermissionResult>;
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
}

export const DEFAULT_TYR_CONFIG: TyrConfig = {
	allowChainedCommands: true,
	allowPromptChecks: false,
	cacheChecks: false,
	failOpen: false,
};
