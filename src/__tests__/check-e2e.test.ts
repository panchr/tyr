import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookResponse } from "../types.ts";
import {
	makePermissionRequest,
	runCheck,
	writeProjectSettings,
} from "./helpers/index.ts";

let tempDir: string;

/** Env vars that isolate the subprocess from the host's real settings. */
function isolatedEnv(projectDir: string): Record<string, string> {
	return {
		CLAUDE_CONFIG_DIR: join(projectDir, "empty-user-config"),
		TYR_CONFIG_FILE: join(projectDir, "tyr-config.json"),
		TYR_LOG_FILE: join(projectDir, "tyr.log"),
	};
}

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-e2e-p1-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("tyr check", () => {
	test("allowed chained command returns allow response", async () => {
		await writeProjectSettings(tempDir, {
			permissions: {
				allow: ["Bash(git *)", "Bash(echo *)"],
			},
		});

		const req = makePermissionRequest({
			cwd: tempDir,
			command: "git status && echo done",
		});

		const result = await runCheck(JSON.stringify(req), {
			env: isolatedEnv(tempDir),
		});

		expect(result.exitCode).toBe(0);
		const response = JSON.parse(result.stdout) as HookResponse;
		expect(response.hookSpecificOutput.decision.behavior).toBe("allow");
	});

	test("denied command in chain returns deny response", async () => {
		await writeProjectSettings(tempDir, {
			permissions: {
				allow: ["Bash(git *)"],
				deny: ["Bash(rm *)"],
			},
		});

		const req = makePermissionRequest({
			cwd: tempDir,
			command: "git status && rm -rf /",
		});

		const result = await runCheck(JSON.stringify(req), {
			env: isolatedEnv(tempDir),
		});

		expect(result.exitCode).toBe(0);
		const response = JSON.parse(result.stdout) as HookResponse;
		expect(response.hookSpecificOutput.decision.behavior).toBe("deny");
	});

	test("unknown command falls through with empty stdout", async () => {
		await writeProjectSettings(tempDir, {
			permissions: {
				allow: ["Bash(git *)"],
			},
		});

		const req = makePermissionRequest({
			cwd: tempDir,
			command: "curl https://example.com",
		});

		const result = await runCheck(JSON.stringify(req), {
			env: isolatedEnv(tempDir),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("");
	});

	test("mixed chain with unknown command falls through", async () => {
		await writeProjectSettings(tempDir, {
			permissions: {
				allow: ["Bash(git *)"],
			},
		});

		const req = makePermissionRequest({
			cwd: tempDir,
			command: "git status && some-unknown-cmd",
		});

		const result = await runCheck(JSON.stringify(req), {
			env: isolatedEnv(tempDir),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("");
	});

	test("malformed JSON input returns exit code 2", async () => {
		const result = await runCheck("not valid json{{{", {
			env: isolatedEnv(tempDir),
		});

		expect(result.exitCode).toBe(2);
	});

	test("valid JSON but invalid PermissionRequest returns exit code 2", async () => {
		const result = await runCheck(JSON.stringify({ wrong: "shape" }), {
			env: isolatedEnv(tempDir),
		});

		expect(result.exitCode).toBe(2);
	});

	test("non-Bash tool falls through with empty stdout", async () => {
		await writeProjectSettings(tempDir, {
			permissions: {
				allow: ["Bash(git *)"],
			},
		});

		const req = makePermissionRequest({
			cwd: tempDir,
			tool_name: "Read",
			tool_input: { file_path: "/tmp/foo" },
		} as Parameters<typeof makePermissionRequest>[0]);

		const result = await runCheck(JSON.stringify(req), {
			env: isolatedEnv(tempDir),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("");
	});

	test("single allowed command returns allow", async () => {
		await writeProjectSettings(tempDir, {
			permissions: {
				allow: ["Bash(npm test)"],
			},
		});

		const req = makePermissionRequest({
			cwd: tempDir,
			command: "npm test",
		});

		const result = await runCheck(JSON.stringify(req), {
			env: isolatedEnv(tempDir),
		});

		expect(result.exitCode).toBe(0);
		const response = JSON.parse(result.stdout) as HookResponse;
		expect(response.hookSpecificOutput.decision.behavior).toBe("allow");
	});

	test("no settings files means all commands fall through", async () => {
		const req = makePermissionRequest({
			cwd: tempDir,
			command: "echo hello",
		});

		const result = await runCheck(JSON.stringify(req), {
			env: isolatedEnv(tempDir),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("");
	});
});
