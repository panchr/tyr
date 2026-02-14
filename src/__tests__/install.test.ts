import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isInstalled,
	mergeHook,
	readSettings,
	writeSettings,
} from "../install.ts";

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-install-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("readSettings", () => {
	test("returns {} for missing file", async () => {
		const result = await readSettings(join(tempDir, "nope.json"));
		expect(result).toEqual({});
	});

	test("parses existing settings", async () => {
		const path = join(tempDir, "settings.json");
		await writeFile(path, JSON.stringify({ foo: "bar" }), "utf-8");
		const result = await readSettings(path);
		expect(result).toEqual({ foo: "bar" });
	});
});

describe("isInstalled", () => {
	test("returns false for empty settings", () => {
		expect(isInstalled({})).toBe(false);
	});

	test("returns false for settings with other hooks", () => {
		expect(
			isInstalled({
				hooks: {
					PermissionRequest: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "other-tool" }],
						},
					],
				},
			}),
		).toBe(false);
	});

	test("returns true when tyr check is present", () => {
		expect(
			isInstalled({
				hooks: {
					PermissionRequest: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "tyr check" }],
						},
					],
				},
			}),
		).toBe(true);
	});
});

describe("mergeHook", () => {
	test("adds hooks to empty settings", () => {
		const result = mergeHook({});
		expect(result.hooks).toBeDefined();
		const hooks = result.hooks as Record<string, unknown>;
		const permReqs = hooks.PermissionRequest as unknown[];
		expect(permReqs).toHaveLength(1);
	});

	test("preserves existing hooks", () => {
		const existing = {
			hooks: {
				PermissionRequest: [
					{ matcher: "Write", hooks: [{ type: "command", command: "other" }] },
				],
			},
		};
		const result = mergeHook(existing);
		const hooks = result.hooks as Record<string, unknown>;
		const permReqs = hooks.PermissionRequest as unknown[];
		expect(permReqs).toHaveLength(2);
	});

	test("preserves non-hook settings", () => {
		const result = mergeHook({ permissions: { allow: ["ls"] } });
		expect(result.permissions).toEqual({ allow: ["ls"] });
	});
});

describe("writeSettings", () => {
	test("creates file and parent directories", async () => {
		const path = join(tempDir, "sub", "dir", "settings.json");
		await writeSettings(path, { test: true });
		const text = await readFile(path, "utf-8");
		expect(JSON.parse(text)).toEqual({ test: true });
	});
});

describe("tyr install (integration)", () => {
	async function runInstall(
		...args: string[]
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const proc = Bun.spawn(["bun", "run", "src/index.ts", "install", ...args], {
			cwd: `${import.meta.dir}/../..`,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				HOME: tempDir,
			},
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		return { stdout, stderr, exitCode };
	}

	test("--dry-run prints config without writing", async () => {
		const { stdout, exitCode } = await runInstall("--dry-run");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Would write to");
		expect(stdout).toContain("tyr check");

		// Verify nothing was written
		const settingsPath = join(tempDir, ".claude", "settings.json");
		const file = Bun.file(settingsPath);
		expect(await file.exists()).toBe(false);
	});

	test("installs hook into empty settings", async () => {
		const { stdout, exitCode } = await runInstall();
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Installed tyr hook");

		const settingsPath = join(tempDir, ".claude", "settings.json");
		const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
		expect(isInstalled(settings)).toBe(true);
	});

	test("detects already installed", async () => {
		// Install once
		await runInstall();
		// Install again
		const { stdout, exitCode } = await runInstall();
		expect(exitCode).toBe(0);
		expect(stdout).toContain("already installed");
	});

	test("does not clobber existing hooks", async () => {
		const settingsPath = join(tempDir, ".claude", "settings.json");
		await writeSettings(settingsPath, {
			hooks: {
				PermissionRequest: [
					{ matcher: "Write", hooks: [{ type: "command", command: "other" }] },
				],
			},
		});

		await runInstall();

		const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
		const permReqs = settings.hooks.PermissionRequest;
		expect(permReqs).toHaveLength(2);
		expect(permReqs[0].matcher).toBe("Write");
	});
});
