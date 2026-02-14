import type { PermissionRequest } from "./types.ts";

/** Validate that a parsed JSON value is a PermissionRequest. */
export function parsePermissionRequest(
	data: unknown,
): PermissionRequest | null {
	if (typeof data !== "object" || data === null) return null;

	const obj = data as Record<string, unknown>;

	if (typeof obj.session_id !== "string") return null;
	if (typeof obj.tool_name !== "string") return null;
	if (typeof obj.tool_input !== "object" || obj.tool_input === null)
		return null;
	if (obj.hook_event_name !== "PermissionRequest") return null;

	return data as PermissionRequest;
}

/** Read all of stdin as a string. */
export async function readStdin(): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf-8");
}
