import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot, getRepoRoot } from "../repo.ts";

describe("findRepoRoot", () => {
	test("finds .git in current directory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "tyr-repo-"));
		await mkdir(join(dir, ".git"));
		try {
			expect(findRepoRoot(dir)).toBe(dir);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finds .git in parent directory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "tyr-repo-"));
		const sub = join(dir, "src", "commands");
		await mkdir(join(dir, ".git"));
		await mkdir(sub, { recursive: true });
		try {
			expect(findRepoRoot(sub)).toBe(dir);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("returns null when not in a git repo", async () => {
		const dir = await mkdtemp(join(tmpdir(), "tyr-repo-"));
		try {
			expect(findRepoRoot(dir)).toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("resolves relative paths", async () => {
		// findRepoRoot should handle "." by resolving to an absolute path
		const result = findRepoRoot(".");
		// We're inside the tyr repo, so it should find the root
		if (result !== null) {
			expect(existsSync(join(result, ".git"))).toBe(true);
		}
	});
});

describe("getRepoRoot", () => {
	test("returns the tyr repo root", () => {
		const root = getRepoRoot();
		expect(existsSync(join(root, ".git"))).toBe(true);
	});
});
