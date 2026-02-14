import { describe, expect, test } from "bun:test";
import {
	MALFORMED_REQUEST,
	makeNonBashRequest,
	makePermissionRequest,
	makeWrongEventRequest,
	runCli,
	runJudge,
} from "./helpers/index.ts";

describe("fixtures", () => {
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

describe("subprocess helpers", () => {
	test("runJudge captures stdout, stderr, and exit code on valid input", async () => {
		const req = makePermissionRequest();
		const result = await runJudge(JSON.stringify(req));
		expect(result.exitCode).toBe(0);
		expect(typeof result.stdout).toBe("string");
		expect(typeof result.stderr).toBe("string");
	});

	test("runJudge captures non-zero exit on bad input", async () => {
		const result = await runJudge("not json");
		expect(result.exitCode).toBe(2);
	});

	test("runJudge passes extra args", async () => {
		const req = makePermissionRequest();
		const result = await runJudge(JSON.stringify(req), {
			args: ["--verbose"],
		});
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContain("[tyr]");
	});

	test("runCli runs arbitrary subcommands", async () => {
		const result = await runCli("--version");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("0.0.0");
	});
});
