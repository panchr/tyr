import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgent } from "../agents/claude.ts";
import { ChainedCommandsProvider } from "../providers/chained-commands.ts";
import type { PermissionRequest } from "../types.ts";

function makeReq(command: string, toolName = "Bash"): PermissionRequest {
	return {
		session_id: "test-session",
		transcript_path: "/tmp/transcript",
		cwd: "/tmp",
		permission_mode: "default",
		hook_event_name: "PermissionRequest",
		tool_name: toolName,
		tool_input: { command },
	};
}

describe("ChainedCommandsProvider", () => {
	let tempDir: string;
	let agent: ClaudeAgent;
	let provider: ChainedCommandsProvider;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-chained-"));
		agent = new ClaudeAgent();

		const settingsDir = join(tempDir, ".claude");
		await mkdir(settingsDir, { recursive: true });
		await writeFile(
			join(settingsDir, "settings.json"),
			JSON.stringify({
				permissions: {
					allow: ["Bash(git *)", "Bash(npm test)", "Bash(echo *)"],
					deny: ["Bash(rm *)", "Bash(git push --force *)"],
				},
			}),
		);

		await agent.init(tempDir, [join(settingsDir, "settings.json")]);
		provider = new ChainedCommandsProvider(agent);
	});

	afterEach(async () => {
		agent.close();
		await rm(tempDir, { recursive: true, force: true });
	});

	test("all-allowed chain returns allow", async () => {
		const result = await provider.checkPermission(
			makeReq("git status && npm test"),
		);
		expect(result.decision).toBe("allow");
	});

	test("one denied command in chain returns deny", async () => {
		const result = await provider.checkPermission(
			makeReq("git status && rm -rf /"),
		);
		expect(result.decision).toBe("deny");
	});

	test("unknown command in chain returns abstain", async () => {
		const result = await provider.checkPermission(
			makeReq("git status && curl example.com"),
		);
		expect(result.decision).toBe("abstain");
	});

	test("single allowed command returns allow", async () => {
		const result = await provider.checkPermission(makeReq("git status"));
		expect(result.decision).toBe("allow");
	});

	test("single denied command returns deny", async () => {
		const result = await provider.checkPermission(makeReq("rm -rf /tmp"));
		expect(result.decision).toBe("deny");
	});

	test("single unknown command returns abstain", async () => {
		const result = await provider.checkPermission(makeReq("curl example.com"));
		expect(result.decision).toBe("abstain");
	});

	test("non-Bash tool returns abstain", async () => {
		const result = await provider.checkPermission(makeReq("anything", "Read"));
		expect(result.decision).toBe("abstain");
	});

	test("empty command returns abstain", async () => {
		const result = await provider.checkPermission(makeReq(""));
		expect(result.decision).toBe("abstain");
	});

	test("piped commands all allowed returns allow", async () => {
		const result = await provider.checkPermission(
			makeReq("echo hello | echo world"),
		);
		expect(result.decision).toBe("allow");
	});

	test("deny wins even in pipes", async () => {
		const result = await provider.checkPermission(
			makeReq("echo hello | rm -rf /"),
		);
		expect(result.decision).toBe("deny");
	});

	test("subshell commands are checked", async () => {
		const result = await provider.checkPermission(
			makeReq("(git status && echo done)"),
		);
		expect(result.decision).toBe("allow");
	});

	test("deny inside subshell returns deny", async () => {
		const result = await provider.checkPermission(
			makeReq("(git status && rm -rf /)"),
		);
		expect(result.decision).toBe("deny");
	});

	test("|| operator: all allowed returns allow", async () => {
		const result = await provider.checkPermission(
			makeReq("git status || echo fallback"),
		);
		expect(result.decision).toBe("allow");
	});

	test("|| operator: deny in second branch returns deny", async () => {
		const result = await provider.checkPermission(
			makeReq("echo hello || rm -rf /"),
		);
		expect(result.decision).toBe("deny");
	});

	test("semicolons: all allowed returns allow", async () => {
		const result = await provider.checkPermission(
			makeReq("git status; echo done"),
		);
		expect(result.decision).toBe("allow");
	});

	test("semicolons: deny in chain returns deny", async () => {
		const result = await provider.checkPermission(
			makeReq("echo hello; rm -rf /"),
		);
		expect(result.decision).toBe("deny");
	});

	test("mixed operators: all allowed returns allow", async () => {
		const result = await provider.checkPermission(
			makeReq("git status && echo ok || echo fail"),
		);
		expect(result.decision).toBe("allow");
	});

	test("mixed operators: unknown causes abstain", async () => {
		const result = await provider.checkPermission(
			makeReq("git status && curl example.com || echo fail"),
		);
		expect(result.decision).toBe("abstain");
	});

	test("mixed operators: deny wins over allowed", async () => {
		const result = await provider.checkPermission(
			makeReq("git status; echo ok || rm -rf /"),
		);
		expect(result.decision).toBe("deny");
	});

	test("command substitution: inner command is checked", async () => {
		const result = await provider.checkPermission(
			makeReq("echo $(git status)"),
		);
		expect(result.decision).toBe("allow");
	});

	test("command substitution: deny inside returns deny", async () => {
		const result = await provider.checkPermission(makeReq("echo $(rm -rf /)"));
		expect(result.decision).toBe("deny");
	});
});
