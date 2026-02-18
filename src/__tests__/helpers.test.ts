import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../version.ts";
import {
	MALFORMED_REQUEST,
	makeNonBashRequest,
	makePermissionRequest,
	makeWrongEventRequest,
	runCli,
	runJudge,
} from "./helpers/index.ts";

let tempDir: string;

/** Env vars that prevent tests from using production config. */
function isolatedEnv(): Record<string, string> {
	return {
		CLAUDE_CONFIG_DIR: join(tempDir, "empty-config"),
		TYR_CONFIG_FILE: join(tempDir, "tyr-config.json"),
		TYR_DB_PATH: join(tempDir, "tyr.db"),
	};
}

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-helpers-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe.concurrent("fixtures", () => {
	test("makePermissionRequest creates valid request", () => {
		const req = makePermissionRequest();
		expect(req.tool_name).toBe("Bash");
		expect(req.hook_event_name).toBe("PermissionRequest");
		expect(req.tool_input.command).toBe("echo hello");
	});

	test("makePermissionRequest accepts overrides", () => {
		const req = makePermissionRequest({
			tool_name: "Read",
			command: "git status",
		});
		expect(req.tool_name).toBe("Read");
		expect(req.tool_input.command).toBe("git status");
	});

	test("makeNonBashRequest creates non-Bash request", () => {
		const req = makeNonBashRequest("Edit");
		expect(req.tool_name).toBe("Edit");
	});

	test("makeWrongEventRequest has wrong event name", () => {
		const req = makeWrongEventRequest();
		expect(req.hook_event_name).toBe("SomethingElse");
	});

	test("MALFORMED_REQUEST is missing required fields", () => {
		expect(MALFORMED_REQUEST).toEqual({ foo: "bar" });
	});
});

describe.concurrent("subprocess helpers", () => {
	test(
		"runJudge captures stdout, stderr, and exit code on valid input",
		async () => {
			const req = makePermissionRequest();
			const result = await runJudge(JSON.stringify(req), {
				env: isolatedEnv(),
			});
			expect(result.exitCode).toBe(0);
			expect(typeof result.stdout).toBe("string");
			expect(typeof result.stderr).toBe("string");
		},
		{ timeout: 10_000 },
	);

	test(
		"runJudge captures non-zero exit on bad input",
		async () => {
			const result = await runJudge("not json", { env: isolatedEnv() });
			expect(result.exitCode).toBe(2);
		},
		{ timeout: 10_000 },
	);

	test(
		"runJudge passes extra args",
		async () => {
			const req = makePermissionRequest();
			const result = await runJudge(JSON.stringify(req), {
				args: ["--verbose"],
				env: isolatedEnv(),
			});
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("[tyr]");
		},
		{ timeout: 10_000 },
	);

	test(
		"runCli runs arbitrary subcommands",
		async () => {
			const result = await runCli("--version", [], { env: isolatedEnv() });
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toContain(VERSION);
		},
		{ timeout: 10_000 },
	);
});
