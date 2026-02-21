import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Walk up from `startDir` looking for a `.git` directory.
 * Returns the repo root or `null` if not inside a git repository.
 */
export function findRepoRoot(startDir: string): string | null {
	let dir = resolve(startDir);
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Returns the repo root for the current directory, falling back to
 * `process.cwd()` when not inside a git repository.
 */
export function getRepoRoot(): string {
	return findRepoRoot(process.cwd()) ?? process.cwd();
}
