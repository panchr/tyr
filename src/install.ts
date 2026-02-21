import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getRepoRoot } from "./repo.ts";

export type JudgeMode = "shadow" | "audit" | undefined;

function tyrCommand(mode: JudgeMode): string {
	if (mode) return `tyr judge --${mode}`;
	return "tyr judge";
}

function tyrHookEntry(mode: JudgeMode) {
	return {
		matcher: "Bash",
		hooks: [{ type: "command", command: tyrCommand(mode) }],
	};
}

export function getSettingsPath(scope: "global" | "project"): string {
	if (scope === "global") {
		return join(homedir(), ".claude", "settings.json");
	}
	return join(getRepoRoot(), ".claude", "settings.json");
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

	return permReqs.some((entry: Record<string, unknown>) => isTyrEntry(entry));
}

/** Merge the tyr hook into settings without clobbering existing hooks.
 *  If a tyr entry already exists it is replaced so install is idempotent. */
export function mergeHook(
	settings: Record<string, unknown>,
	mode?: JudgeMode,
): Record<string, unknown> {
	const result = { ...settings };
	const hooks = (result.hooks ?? {}) as Record<string, unknown>;
	const permReqs = Array.isArray(hooks.PermissionRequest)
		? (hooks.PermissionRequest as Record<string, unknown>[]).filter(
				(entry) => !isTyrEntry(entry),
			)
		: [];

	permReqs.push(tyrHookEntry(mode));

	result.hooks = { ...hooks, PermissionRequest: permReqs };
	return result;
}

/** Check if a PermissionRequest entry belongs to tyr. */
function isTyrEntry(entry: Record<string, unknown>): boolean {
	const entryHooks = entry.hooks;
	if (!Array.isArray(entryHooks)) return false;
	return entryHooks.some(
		(h: Record<string, unknown>) =>
			h.type === "command" &&
			typeof h.command === "string" &&
			h.command.startsWith("tyr "),
	);
}

/** Remove the tyr hook from settings, returning the cleaned settings.
 *  Returns null if tyr was not installed. */
export function removeHook(
	settings: Record<string, unknown>,
): Record<string, unknown> | null {
	if (!isInstalled(settings)) return null;

	const result = { ...settings };
	const hooks = { ...(result.hooks as Record<string, unknown>) };
	const permReqs = hooks.PermissionRequest as Record<string, unknown>[];
	const filtered = permReqs.filter((entry) => !isTyrEntry(entry));

	if (filtered.length > 0) {
		hooks.PermissionRequest = filtered;
	} else {
		delete hooks.PermissionRequest;
	}

	// Clean up empty hooks object
	if (Object.keys(hooks).length === 0) {
		delete result.hooks;
	} else {
		result.hooks = hooks;
	}

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
