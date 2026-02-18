import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgent } from "../agents/claude.ts";
import type { HookResponse } from "../types.ts";
import {
	makePermissionRequest,
	runJudge,
	writeLocalSettings,
	writeProjectSettings,
	writeUserSettings,
} from "./helpers/index.ts";

describe("ClaudeAgent: multi-file merge", () => {
	let tempDir: string;
	let agent: ClaudeAgent;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-merge-"));
		agent = new ClaudeAgent();
	});

	afterEach(async () => {
		agent.close();
		await rm(tempDir, { recursive: true, force: true });
	});

	test("merges allow rules from multiple files", async () => {
		const userDir = join(tempDir, "user-config");
		const projectPath = await writeProjectSettings(tempDir, {
			permissions: { allow: ["Bash(git *)"] },
		});
		const userPath = await writeUserSettings(userDir, {
			permissions: { allow: ["Bash(npm test)"] },
		});

		await agent.init(tempDir, [projectPath, userPath]);

		expect(agent.isCommandAllowed("git status")).toBe("allow");
		expect(agent.isCommandAllowed("npm test")).toBe("allow");
		expect(agent.isCommandAllowed("curl foo")).toBe("unknown");
	});

	test("merges deny rules from multiple files", async () => {
		const localPath = await writeLocalSettings(tempDir, {
			permissions: { deny: ["Bash(rm *)"] },
		});
		const projectPath = await writeProjectSettings(tempDir, {
			permissions: { deny: ["Bash(curl *)"] },
		});

		await agent.init(tempDir, [localPath, projectPath]);

		expect(agent.isCommandAllowed("rm -rf /")).toBe("deny");
		expect(agent.isCommandAllowed("curl evil.com")).toBe("deny");
	});

	test("three files: local deny + project allow + user allow", async () => {
		const userDir = join(tempDir, "user-config");
		const localPath = await writeLocalSettings(tempDir, {
			permissions: { deny: ["Bash(git push --force *)"] },
		});
		const projectPath = await writeProjectSettings(tempDir, {
			permissions: { allow: ["Bash(git *)"] },
		});
		const userPath = await writeUserSettings(userDir, {
			permissions: { allow: ["Bash(npm *)"] },
		});

		await agent.init(tempDir, [localPath, projectPath, userPath]);

		expect(agent.isCommandAllowed("git status")).toBe("allow");
		expect(agent.isCommandAllowed("npm test")).toBe("allow");
		expect(agent.isCommandAllowed("git push --force origin main")).toBe("deny");
	});

	test("deny wins when same pattern appears in allow and deny from different files", async () => {
		const userDir = join(tempDir, "user-config");
		const projectPath = await writeProjectSettings(tempDir, {
			permissions: { allow: ["Bash(rm *)"] },
		});
		const userPath = await writeUserSettings(userDir, {
			permissions: { deny: ["Bash(rm *)"] },
		});

		await agent.init(tempDir, [projectPath, userPath]);

		expect(agent.isCommandAllowed("rm -rf /")).toBe("deny");
	});

	test("malformed JSON in one file doesn't break other files", async () => {
		const claudeDir = join(tempDir, ".claude");
		const malformedPath = join(claudeDir, "settings.local.json");
		const projectPath = await writeProjectSettings(tempDir, {
			permissions: { allow: ["Bash(echo *)"] },
		});
		await writeFile(malformedPath, "not json {{{{", "utf-8");

		await agent.init(tempDir, [malformedPath, projectPath]);

		expect(agent.isCommandAllowed("echo hello")).toBe("allow");
	});

	test("permissions field with wrong type is safely skipped", async () => {
		const claudeDir = join(tempDir, ".claude");
		const weirdPath = join(claudeDir, "settings.local.json");
		const projectPath = await writeProjectSettings(tempDir, {
			permissions: { allow: ["Bash(echo *)"] },
		});
		await writeFile(
			weirdPath,
			JSON.stringify({ permissions: "not an object" }),
			"utf-8",
		);

		await agent.init(tempDir, [weirdPath, projectPath]);

		expect(agent.isCommandAllowed("echo hello")).toBe("allow");
	});

	test("allow/deny arrays with non-string entries are handled", async () => {
		const projectPath = await writeProjectSettings(tempDir, {
			permissions: {
				allow: [
					123,
					null,
					"Bash(echo *)",
					{ tool: "Bash" },
				] as unknown as string[],
				deny: [true, "Bash(rm *)"] as unknown as string[],
			},
		});

		await agent.init(tempDir, [projectPath]);

		expect(agent.isCommandAllowed("echo hello")).toBe("allow");
		expect(agent.isCommandAllowed("rm -rf /")).toBe("deny");
	});

	test("empty permissions object is handled", async () => {
		const projectPath = await writeProjectSettings(tempDir, {
			permissions: {},
		});

		await agent.init(tempDir, [projectPath]);

		expect(agent.isCommandAllowed("anything")).toBe("unknown");
	});

	test("settings with no permissions field is handled", async () => {
		const projectPath = await writeProjectSettings(tempDir, {});

		await agent.init(tempDir, [projectPath]);

		expect(agent.isCommandAllowed("anything")).toBe("unknown");
	});
});

describe("tyr judge: settings merge across scopes", () => {
	let tempDir: string;

	function isolatedEnv(
		projectDir: string,
		configDir?: string,
	): Record<string, string> {
		return {
			CLAUDE_CONFIG_DIR: configDir ?? join(projectDir, "empty-user-config"),
			TYR_CONFIG_FILE: join(projectDir, "tyr-config.json"),
		};
	}

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-merge-e2e-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test(
		"local deny overrides project allow",
		async () => {
			await writeProjectSettings(tempDir, {
				permissions: { allow: ["Bash(git *)"] },
			});
			await writeLocalSettings(tempDir, {
				permissions: { deny: ["Bash(git push *)"] },
			});

			const req = makePermissionRequest({
				cwd: tempDir,
				command: "git push origin main",
			});
			const result = await runJudge(JSON.stringify(req), {
				env: isolatedEnv(tempDir),
			});

			expect(result.exitCode).toBe(0);
			const response = JSON.parse(result.stdout) as HookResponse;
			expect(response.hookSpecificOutput.decision.behavior).toBe("deny");
		},
		{ timeout: 10_000 },
	);

	test(
		"user-global allow is picked up via CLAUDE_CONFIG_DIR",
		async () => {
			const userDir = join(tempDir, "user-claude");
			await writeUserSettings(userDir, {
				permissions: { allow: ["Bash(npm test)"] },
			});

			const req = makePermissionRequest({
				cwd: tempDir,
				command: "npm test",
			});
			const result = await runJudge(JSON.stringify(req), {
				env: isolatedEnv(tempDir, userDir),
			});

			expect(result.exitCode).toBe(0);
			const response = JSON.parse(result.stdout) as HookResponse;
			expect(response.hookSpecificOutput.decision.behavior).toBe("allow");
		},
		{ timeout: 10_000 },
	);

	test(
		"project allow and user allow both contribute rules",
		async () => {
			const userDir = join(tempDir, "user-claude");
			await writeProjectSettings(tempDir, {
				permissions: { allow: ["Bash(git *)"] },
			});
			await writeUserSettings(userDir, {
				permissions: { allow: ["Bash(npm test)"] },
			});

			// Verify project rule works
			const gitReq = makePermissionRequest({
				cwd: tempDir,
				command: "git status",
			});
			const gitResult = await runJudge(JSON.stringify(gitReq), {
				env: isolatedEnv(tempDir, userDir),
			});
			expect(gitResult.exitCode).toBe(0);
			const gitResponse = JSON.parse(gitResult.stdout) as HookResponse;
			expect(gitResponse.hookSpecificOutput.decision.behavior).toBe("allow");

			// Verify user rule works
			const npmReq = makePermissionRequest({
				cwd: tempDir,
				command: "npm test",
			});
			const npmResult = await runJudge(JSON.stringify(npmReq), {
				env: isolatedEnv(tempDir, userDir),
			});
			expect(npmResult.exitCode).toBe(0);
			const npmResponse = JSON.parse(npmResult.stdout) as HookResponse;
			expect(npmResponse.hookSpecificOutput.decision.behavior).toBe("allow");
		},
		{ timeout: 10_000 },
	);

	test(
		"three scopes: local deny + project allow + user allow",
		async () => {
			const userDir = join(tempDir, "user-claude");
			await writeLocalSettings(tempDir, {
				permissions: { deny: ["Bash(git push --force *)"] },
			});
			await writeProjectSettings(tempDir, {
				permissions: { allow: ["Bash(git *)"] },
			});
			await writeUserSettings(userDir, {
				permissions: { allow: ["Bash(echo *)"] },
			});

			// git status is allowed (project), force push is denied (local)
			const allowReq = makePermissionRequest({
				cwd: tempDir,
				command: "git status",
			});
			const allowResult = await runJudge(JSON.stringify(allowReq), {
				env: isolatedEnv(tempDir, userDir),
			});
			expect(allowResult.exitCode).toBe(0);
			const allowResponse = JSON.parse(allowResult.stdout) as HookResponse;
			expect(allowResponse.hookSpecificOutput.decision.behavior).toBe("allow");

			const denyReq = makePermissionRequest({
				cwd: tempDir,
				command: "git push --force origin main",
			});
			const denyResult = await runJudge(JSON.stringify(denyReq), {
				env: isolatedEnv(tempDir, userDir),
			});
			expect(denyResult.exitCode).toBe(0);
			const denyResponse = JSON.parse(denyResult.stdout) as HookResponse;
			expect(denyResponse.hookSpecificOutput.decision.behavior).toBe("deny");
		},
		{ timeout: 10_000 },
	);

	test(
		"malformed settings file doesn't crash tyr judge",
		async () => {
			await writeProjectSettings(tempDir, {
				permissions: { allow: ["Bash(echo *)"] },
			});
			const claudeDir = join(tempDir, ".claude");
			await writeFile(
				join(claudeDir, "settings.local.json"),
				"{{not json at all",
				"utf-8",
			);

			const req = makePermissionRequest({
				cwd: tempDir,
				command: "echo hello",
			});
			const result = await runJudge(JSON.stringify(req), {
				env: isolatedEnv(tempDir),
			});

			expect(result.exitCode).toBe(0);
			const response = JSON.parse(result.stdout) as HookResponse;
			expect(response.hookSpecificOutput.decision.behavior).toBe("allow");
		},
		{ timeout: 10_000 },
	);
});
