import { describe, expect, test } from "bun:test";
import { ClaudeAgent } from "../agents/claude.ts";
import { buildPrompt, parseLlmResponse } from "../providers/llm.ts";
import { makePermissionRequest } from "./helpers/index.ts";

describe.concurrent("buildPrompt", () => {
	test("includes the command in the prompt", async () => {
		const agent = new ClaudeAgent();
		const req = makePermissionRequest({ command: "rm -rf /" });
		const prompt = buildPrompt(req, agent);
		expect(prompt).toContain("rm -rf /");
	});

	test("includes allowed and denied patterns", async () => {
		const agent = new ClaudeAgent();
		// Initialize with settings that have permissions
		const { mkdtemp, rm, writeFile, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const tempDir = await mkdtemp(join(tmpdir(), "tyr-llm-test-"));
		try {
			await mkdir(join(tempDir, ".claude"), { recursive: true });
			await writeFile(
				join(tempDir, ".claude", "settings.json"),
				JSON.stringify({
					permissions: {
						allow: ["Bash(git *)", "Bash(npm test)"],
						deny: ["Bash(rm *)"],
					},
				}),
			);

			await agent.init(tempDir, [join(tempDir, ".claude", "settings.json")]);
			const req = makePermissionRequest({ cwd: tempDir, command: "curl foo" });
			const prompt = buildPrompt(req, agent);

			expect(prompt).toContain("git *");
			expect(prompt).toContain("npm test");
			expect(prompt).toContain("rm *");
			agent.close();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("includes working directory", () => {
		const agent = new ClaudeAgent();
		const req = makePermissionRequest({
			cwd: "/home/user/project",
			command: "ls",
		});
		const prompt = buildPrompt(req, agent);
		expect(prompt).toContain("/home/user/project");
	});
});

describe.concurrent("parseLlmResponse", () => {
	test("parses valid allow response", () => {
		const result = parseLlmResponse(
			'{"decision": "allow", "reason": "safe command"}',
		);
		expect(result).toEqual({ decision: "allow", reason: "safe command" });
	});

	test("parses valid deny response", () => {
		const result = parseLlmResponse(
			'{"decision": "deny", "reason": "dangerous command"}',
		);
		expect(result).toEqual({ decision: "deny", reason: "dangerous command" });
	});

	test("handles markdown code fences", () => {
		const result = parseLlmResponse(
			'```json\n{"decision": "allow", "reason": "ok"}\n```',
		);
		expect(result).toEqual({ decision: "allow", reason: "ok" });
	});

	test("handles code fence without language tag", () => {
		const result = parseLlmResponse(
			'```\n{"decision": "deny", "reason": "bad"}\n```',
		);
		expect(result).toEqual({ decision: "deny", reason: "bad" });
	});

	test("returns null for empty string", () => {
		expect(parseLlmResponse("")).toBeNull();
	});

	test("returns null for invalid JSON", () => {
		expect(parseLlmResponse("not json")).toBeNull();
	});

	test("returns null for missing decision field", () => {
		expect(parseLlmResponse('{"reason": "ok"}')).toBeNull();
	});

	test("returns null for invalid decision value", () => {
		expect(
			parseLlmResponse('{"decision": "maybe", "reason": "unsure"}'),
		).toBeNull();
	});

	test("returns null for missing reason field", () => {
		expect(parseLlmResponse('{"decision": "allow"}')).toBeNull();
	});

	test("handles whitespace around response", () => {
		const result = parseLlmResponse(
			'  \n {"decision": "allow", "reason": "ok"} \n  ',
		);
		expect(result).toEqual({ decision: "allow", reason: "ok" });
	});
});

describe.concurrent("LlmProvider", () => {
	test("abstains for non-Bash tools", async () => {
		const { LlmProvider } = await import("../providers/llm.ts");
		const agent = new ClaudeAgent();
		const provider = new LlmProvider(agent);

		const req = makePermissionRequest({
			tool_name: "Read",
			tool_input: { file_path: "/tmp/foo" },
		} as Parameters<typeof makePermissionRequest>[0]);

		const result = await provider.checkPermission(req);
		expect(result).toBe("abstain");
	});

	test("abstains for empty command", async () => {
		const { LlmProvider } = await import("../providers/llm.ts");
		const agent = new ClaudeAgent();
		const provider = new LlmProvider(agent);

		const req = makePermissionRequest({ command: "" });
		const result = await provider.checkPermission(req);
		expect(result).toBe("abstain");
	});

	test("abstains for missing command", async () => {
		const { LlmProvider } = await import("../providers/llm.ts");
		const agent = new ClaudeAgent();
		const provider = new LlmProvider(agent);

		const req = makePermissionRequest();
		req.tool_input = {};
		const result = await provider.checkPermission(req);
		expect(result).toBe("abstain");
	});

	test("uses Bun.spawn with array args (no shell interpolation)", async () => {
		// Verify the implementation uses array args by checking the source.
		// This is a design constraint to prevent injection.
		const { readFile } = await import("node:fs/promises");
		const { resolve } = await import("node:path");
		const source = await readFile(
			resolve(import.meta.dir, "../providers/llm.ts"),
			"utf-8",
		);

		// Should use Bun.spawn with array, not a string
		expect(source).toContain('Bun.spawn(["claude"');
		// Should not use shell: true or pass a string command
		expect(source).not.toContain("shell: true");
	});
});
