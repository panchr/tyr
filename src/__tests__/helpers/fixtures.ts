import type { PermissionRequest } from "../../types.ts";

/** A valid Bash PermissionRequest for use in tests. */
export function makePermissionRequest(
	overrides: Partial<PermissionRequest> & { command?: string } = {},
): PermissionRequest {
	const { command, ...rest } = overrides;
	return {
		session_id: "test-session",
		transcript_path: "/tmp/transcript.jsonl",
		cwd: "/working/directory",
		permission_mode: "default",
		hook_event_name: "PermissionRequest",
		tool_name: "Bash",
		tool_input: { command: command ?? "echo hello" },
		...rest,
	};
}

/** A malformed payload missing required fields. */
export const MALFORMED_REQUEST = { foo: "bar" };

/** Valid JSON but wrong hook event name. */
export function makeWrongEventRequest(): Record<string, unknown> {
	return {
		...makePermissionRequest(),
		hook_event_name: "SomethingElse",
	};
}

/** A request for a non-Bash tool. */
export function makeNonBashRequest(toolName = "Read"): PermissionRequest {
	return makePermissionRequest({
		tool_name: toolName,
		tool_input: { file_path: "/tmp/foo" },
	} as Partial<PermissionRequest>);
}
