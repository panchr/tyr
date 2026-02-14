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
		expect(result).toBe("allow");
	});

	test("one denied command in chain returns deny", async () => {
		const result = await provider.checkPermission(
			makeReq("git status && rm -rf /"),
		);
		expect(result).toBe("deny");
	});

	test("unknown command in chain returns abstain", async () => {
		const result = await provider.checkPermission(
			makeReq("git status && curl example.com"),
		);
		expect(result).toBe("abstain");
	});

	test("single allowed command returns allow", async () => {
		const result = await provider.checkPermission(makeReq("git status"));
		expect(result).toBe("allow");
	});

	test("single denied command returns deny", async () => {
		const result = await provider.checkPermission(makeReq("rm -rf /tmp"));
		expect(result).toBe("deny");
	});

	test("single unknown command returns abstain", async () => {
		const result = await provider.checkPermission(makeReq("curl example.com"));
		expect(result).toBe("abstain");
	});

	test("non-Bash tool returns abstain", async () => {
		const result = await provider.checkPermission(makeReq("anything", "Read"));
		expect(result).toBe("abstain");
	});

	test("empty command returns abstain", async () => {
		const result = await provider.checkPermission(makeReq(""));
		expect(result).toBe("abstain");
	});

	test("piped commands all allowed returns allow", async () => {
		const result = await provider.checkPermission(
			makeReq("echo hello | echo world"),
		);
		expect(result).toBe("allow");
	});

	test("deny wins even in pipes", async () => {
		const result = await provider.checkPermission(
			makeReq("echo hello | rm -rf /"),
		);
		expect(result).toBe("deny");
	});

	test("subshell commands are checked", async () => {
		const result = await provider.checkPermission(
			makeReq("(git status && echo done)"),
		);
		expect(result).toBe("allow");
	});

	test("deny inside subshell returns deny", async () => {
		const result = await provider.checkPermission(
			makeReq("(git status && rm -rf /)"),
		);
		expect(result).toBe("deny");
	});
});
