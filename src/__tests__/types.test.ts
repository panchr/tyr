import { describe, expect, test } from "bun:test";
import {
	DEFAULT_TYR_CONFIG,
	type HookResponse,
	type PermissionRequest,
	type PermissionResult,
	type Provider,
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
});

describe.concurrent("Provider", () => {
	test("can implement the Provider interface", async () => {
		const stubProvider: Provider = {
			name: "stub",
			checkPermission: async () => "abstain",
		};
		const result = await stubProvider.checkPermission({
			...({} as PermissionRequest),
		});
		expect(result).toBe("abstain");
	});
});

describe.concurrent("TyrConfig", () => {
	test("DEFAULT_TYR_CONFIG has expected defaults", () => {
		expect(DEFAULT_TYR_CONFIG).toEqual({
			allowChainedCommands: true,
			allowPromptChecks: false,
			cacheChecks: false,
			failOpen: false,
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
