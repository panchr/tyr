import { type FSWatcher, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readSettings } from "../install.ts";

/** Parse Bash permission rules into command patterns.
 *  "Bash(npm run *)" → "npm run *", bare "Bash" → "*".
 *  Non-Bash rules are ignored. */
export function extractBashPatterns(rules: unknown[]): string[] {
	const patterns: string[] = [];
	for (const rule of rules) {
		if (typeof rule !== "string") continue;
		if (rule === "Bash") {
			patterns.push("*");
			continue;
		}
		const match = rule.match(/^Bash\((.+)\)$/);
		if (match?.[1]) {
			patterns.push(match[1]);
		}
	}
	return patterns;
}

/** Check if a command matches a glob-style pattern.
 *  `*` in the pattern matches any sequence of characters. */
export function matchPattern(pattern: string, command: string): boolean {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
	return regex.test(command);
}

/** Return settings file paths in precedence order (highest first). */
export function settingsPaths(cwd: string): string[] {
	const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
	const paths: string[] = [];

	// 1. Managed (macOS)
	if (process.platform === "darwin") {
		paths.push("/Library/Application Support/ClaudeCode/managed-settings.json");
	}

	// 2. Local project
	paths.push(join(cwd, ".claude", "settings.local.json"));

	// 3. Project shared
	paths.push(join(cwd, ".claude", "settings.json"));

	// 4. User global
	paths.push(join(configDir, "settings.json"));

	return paths;
}

interface MergedPermissions {
	allow: string[];
	deny: string[];
}

/** Merge permissions from all settings files in precedence order. */
async function loadPermissions(paths: string[]): Promise<MergedPermissions> {
	const allow: string[] = [];
	const deny: string[] = [];

	for (const path of paths) {
		const settings = await readSettings(path);
		const perms = settings.permissions as Record<string, unknown> | undefined;
		if (!perms) continue;

		if (Array.isArray(perms.allow)) {
			allow.push(...extractBashPatterns(perms.allow));
		}
		if (Array.isArray(perms.deny)) {
			deny.push(...extractBashPatterns(perms.deny));
		}
	}

	return { allow, deny };
}

export class ClaudeAgent {
	private allow: string[] = [];
	private deny: string[] = [];
	private watchers: FSWatcher[] = [];
	private paths: string[] = [];

	/** Read all settings files and start watching for changes.
	 *  If `paths` is provided, use those instead of auto-detected paths. */
	async init(cwd?: string, paths?: string[]): Promise<void> {
		this.paths = paths ?? settingsPaths(cwd ?? process.cwd());
		await this.reload();

		for (const path of this.paths) {
			try {
				const watcher = watch(path, () => {
					void this.reload();
				});
				this.watchers.push(watcher);
			} catch {
				// File doesn't exist yet — skip watching
			}
		}
	}

	/** Check if a command is allowed/denied/unknown per configured permissions. */
	isCommandAllowed(cmd: string): "allow" | "deny" | "unknown" {
		// Deny rules are evaluated first; first match wins.
		for (const pattern of this.deny) {
			if (matchPattern(pattern, cmd)) return "deny";
		}
		for (const pattern of this.allow) {
			if (matchPattern(pattern, cmd)) return "allow";
		}
		return "unknown";
	}

	/** Stop watching settings files. */
	close(): void {
		for (const watcher of this.watchers) {
			watcher.close();
		}
		this.watchers = [];
	}

	private async reload(): Promise<void> {
		const perms = await loadPermissions(this.paths);
		this.allow = perms.allow;
		this.deny = perms.deny;
	}
}
