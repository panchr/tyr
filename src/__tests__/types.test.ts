import { describe, expect, test } from "bun:test";
import {
	DEFAULT_TYR_CONFIG,
	type HookResponse,
	type PermissionRequest,
	type PermissionResult,
	type Provider,
	resolveProviders,
	type TyrConfig,
} from "../types.ts";

describe.concurrent("PermissionRequest", () => {
	const validRequest: PermissionRequest = {
		session_id: "abc123",
		transcript_path: "/path/to/transcript.jsonl",
		cwd: "/working/directory",
		permission_mode: "default",
		hook_event_name: "PermissionRequest",
		tool_name: "Bash",
		tool_input: {
			command: "bun test | less",
			description: "Run tests and page output",
		},
	};

	test("accepts valid PermissionRequest shape", () => {
		// Type-level: this assignment compiles only if the shape matches.
		const req: PermissionRequest = validRequest;
		expect(req.hook_event_name).toBe("PermissionRequest");
		expect(req.tool_name).toBe("Bash");
		expect(req.tool_input).toHaveProperty("command");
	});

	test("tool_input accepts arbitrary keys", () => {
		const req: PermissionRequest = {
			...validRequest,
			tool_input: { file_path: "/etc/passwd", content: "..." },
		};
		expect(req.tool_input).toHaveProperty("file_path");
	});

	test("parses valid JSON into PermissionRequest", () => {
		const json = JSON.stringify(validRequest);
		const parsed: PermissionRequest = JSON.parse(json);
		expect(parsed.session_id).toBe("abc123");
		expect(parsed.tool_name).toBe("Bash");
	});
});

describe.concurrent("PermissionResult", () => {
	test("allows valid values", () => {
		const values: PermissionResult[] = ["allow", "deny", "abstain"];
		expect(values).toHaveLength(3);
	});
});

describe.concurrent("HookResponse", () => {
	test("allow response has correct shape", () => {
		const response: HookResponse = {
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "allow" },
			},
		};
		expect(response.hookSpecificOutput.decision.behavior).toBe("allow");
	});

	test("deny response has correct shape", () => {
		const response: HookResponse = {
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "deny" },
			},
		};
		expect(response.hookSpecificOutput.decision.behavior).toBe("deny");
	});

	test("deny response can include message", () => {
		const response: HookResponse = {
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "deny", message: "matches denied pattern" },
			},
		};
		expect(response.hookSpecificOutput.decision.message).toBe(
			"matches denied pattern",
		);
	});
});

describe.concurrent("Provider", () => {
	test("can implement the Provider interface", async () => {
		const stubProvider: Provider = {
			name: "stub",
			checkPermission: async () => ({ decision: "abstain" }),
		};
		const result = await stubProvider.checkPermission({
			...({} as PermissionRequest),
		});
		expect(result.decision).toBe("abstain");
	});
});

describe.concurrent("TyrConfig", () => {
	test("DEFAULT_TYR_CONFIG has expected defaults", () => {
		expect(DEFAULT_TYR_CONFIG).toEqual({
			allowChainedCommands: true,
			allowPromptChecks: false,
			cacheChecks: false,
			failOpen: false,
			llm: {
				provider: "claude",
				model: "haiku",
				endpoint: "https://openrouter.ai/api/v1",
				timeout: 10,
				canDeny: false,
			},
			verboseLog: false,
		});
	});

	test("config can be partially overridden", () => {
		const custom: TyrConfig = {
			...DEFAULT_TYR_CONFIG,
			failOpen: true,
		};
		expect(custom.failOpen).toBe(true);
		expect(custom.allowChainedCommands).toBe(true);
	});
});

describe.concurrent("resolveProviders", () => {
	test("uses explicit providers array when set", () => {
		const config: TyrConfig = {
			...DEFAULT_TYR_CONFIG,
			providers: ["llm", "chained-commands"],
		};
		expect(resolveProviders(config)).toEqual(["llm", "chained-commands"]);
	});

	test("derives from boolean flags when providers is undefined", () => {
		expect(resolveProviders(DEFAULT_TYR_CONFIG)).toEqual(["chained-commands"]);
	});

	test("includes all providers when all flags are true", () => {
		const config: TyrConfig = {
			...DEFAULT_TYR_CONFIG,
			cacheChecks: true,
			allowChainedCommands: true,
			allowPromptChecks: true,
		};
		expect(resolveProviders(config)).toEqual([
			"cache",
			"chained-commands",
			"llm",
		]);
	});

	test("returns empty array when all flags are false", () => {
		const config: TyrConfig = {
			...DEFAULT_TYR_CONFIG,
			allowChainedCommands: false,
		};
		expect(resolveProviders(config)).toEqual([]);
	});

	test("explicit providers ignores boolean flags", () => {
		const config: TyrConfig = {
			...DEFAULT_TYR_CONFIG,
			providers: ["llm"],
			allowChainedCommands: true,
			allowPromptChecks: false,
			cacheChecks: true,
		};
		expect(resolveProviders(config)).toEqual(["llm"]);
	});
});
