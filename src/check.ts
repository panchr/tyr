import { type PermissionRequest, PermissionRequestSchema } from "./types.ts";

/** Parse and validate a PermissionRequest from unknown input. */
export function parsePermissionRequest(
	data: unknown,
): PermissionRequest | null {
	const result = PermissionRequestSchema.safeParse(data);
	if (!result.success) return null;
	return result.data;
}

/** Read all of stdin as a string. */
export async function readStdin(): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf-8");
}
