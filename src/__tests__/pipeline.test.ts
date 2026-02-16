import { describe, expect, test } from "bun:test";
import { runPipeline } from "../pipeline.ts";
import type {
	PermissionRequest,
	PermissionResult,
	Provider,
} from "../types.ts";

function makeReq(command = "echo hello"): PermissionRequest {
	return {
		session_id: "test",
		transcript_path: "/tmp/transcript",
		cwd: "/tmp",
		permission_mode: "default",
		hook_event_name: "PermissionRequest",
		tool_name: "Bash",
		tool_input: { command },
	};
}

function makeProvider(
	name: string,
	decision: PermissionResult,
	reason?: string,
): Provider {
	return {
		name,
		async checkPermission() {
			return { decision, reason };
		},
	};
}

function makeErrorProvider(name: string): Provider {
	return {
		name,
		async checkPermission() {
			throw new Error("boom");
		},
	};
}

describe.concurrent("runPipeline", () => {
	test("first allow wins", async () => {
		const result = await runPipeline(
			[makeProvider("a", "abstain"), makeProvider("b", "allow")],
			makeReq(),
		);
		expect(result).toEqual({
			decision: "allow",
			provider: "b",
			reason: undefined,
		});
	});

	test("first deny wins", async () => {
		const result = await runPipeline(
			[makeProvider("a", "deny"), makeProvider("b", "allow")],
			makeReq(),
		);
		expect(result).toEqual({
			decision: "deny",
			provider: "a",
			reason: undefined,
		});
	});

	test("all abstain returns abstain with no provider", async () => {
		const result = await runPipeline(
			[makeProvider("a", "abstain"), makeProvider("b", "abstain")],
			makeReq(),
		);
		expect(result).toEqual({ decision: "abstain", provider: null });
	});

	test("empty providers list returns abstain", async () => {
		const result = await runPipeline([], makeReq());
		expect(result).toEqual({ decision: "abstain", provider: null });
	});

	test("provider ordering is respected", async () => {
		const result = await runPipeline(
			[makeProvider("first", "allow"), makeProvider("second", "deny")],
			makeReq(),
		);
		expect(result).toEqual({
			decision: "allow",
			provider: "first",
			reason: undefined,
		});
	});

	test("error provider is treated as abstain", async () => {
		const result = await runPipeline(
			[makeErrorProvider("broken"), makeProvider("fallback", "allow")],
			makeReq(),
		);
		expect(result).toEqual({
			decision: "allow",
			provider: "fallback",
			reason: undefined,
		});
	});

	test("all errors returns abstain", async () => {
		const result = await runPipeline(
			[makeErrorProvider("a"), makeErrorProvider("b")],
			makeReq(),
		);
		expect(result).toEqual({ decision: "abstain", provider: null });
	});

	test("abstain then allow skips abstain", async () => {
		const calls: string[] = [];
		const trackingProvider = (
			name: string,
			decision: PermissionResult,
		): Provider => ({
			name,
			async checkPermission() {
				calls.push(name);
				return { decision };
			},
		});

		await runPipeline(
			[
				trackingProvider("first", "abstain"),
				trackingProvider("second", "allow"),
				trackingProvider("third", "deny"),
			],
			makeReq(),
		);

		// Third should not be called because second returned allow
		expect(calls).toEqual(["first", "second"]);
	});

	test("reason is threaded through on deny", async () => {
		const result = await runPipeline(
			[makeProvider("llm", "deny", "matches denied pattern rm *")],
			makeReq(),
		);
		expect(result).toEqual({
			decision: "deny",
			provider: "llm",
			reason: "matches denied pattern rm *",
		});
	});

	test("reason is threaded through on allow", async () => {
		const result = await runPipeline(
			[makeProvider("llm", "allow", "matches allowed pattern git *")],
			makeReq(),
		);
		expect(result).toEqual({
			decision: "allow",
			provider: "llm",
			reason: "matches allowed pattern git *",
		});
	});
});
