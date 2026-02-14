import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const TYR_HOOK = {
	type: "command",
	command: "tyr check",
};

/** The hook entry tyr installs for PermissionRequest events. */
const TYR_HOOK_ENTRY = {
	matcher: "Bash",
	hooks: [TYR_HOOK],
};

export function getSettingsPath(scope: "global" | "project"): string {
	if (scope === "global") {
		return join(homedir(), ".claude", "settings.json");
	}
	return join(process.cwd(), ".claude", "settings.json");
}

/** Read and parse a settings.json, returning {} if it doesn't exist. */
export async function readSettings(
	path: string,
): Promise<Record<string, unknown>> {
	try {
		const text = await readFile(path, "utf-8");
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** Check if tyr is already installed in the given settings. */
export function isInstalled(settings: Record<string, unknown>): boolean {
	const hooks = settings.hooks as Record<string, unknown> | undefined;
	if (!hooks) return false;

	const permReqs = hooks.PermissionRequest;
	if (!Array.isArray(permReqs)) return false;

	return permReqs.some((entry: Record<string, unknown>) => {
		const entryHooks = entry.hooks;
		if (!Array.isArray(entryHooks)) return false;
		return entryHooks.some(
			(h: Record<string, unknown>) =>
				h.type === "command" && h.command === "tyr check",
		);
	});
}

/** Merge the tyr hook into settings without clobbering existing hooks. */
export function mergeHook(
	settings: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...settings };
	const hooks = (result.hooks ?? {}) as Record<string, unknown>;
	const permReqs = Array.isArray(hooks.PermissionRequest)
		? [...hooks.PermissionRequest]
		: [];

	permReqs.push(TYR_HOOK_ENTRY);

	result.hooks = { ...hooks, PermissionRequest: permReqs };
	return result;
}

/** Write settings to disk, creating parent directories as needed. */
export async function writeSettings(
	path: string,
	settings: Record<string, unknown>,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}
