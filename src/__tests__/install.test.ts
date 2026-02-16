import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isInstalled,
	mergeHook,
	readSettings,
	removeHook,
	writeSettings,
} from "../install.ts";

describe("readSettings", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-install-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

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

describe.concurrent("isInstalled", () => {
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

	test("returns true when tyr judge is present", () => {
		expect(
			isInstalled({
				hooks: {
					PermissionRequest: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "tyr judge" }],
						},
					],
				},
			}),
		).toBe(true);
	});
});

describe.concurrent("mergeHook", () => {
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

	test("replaces existing tyr entry instead of duplicating", () => {
		const existing = {
			hooks: {
				PermissionRequest: [
					{ matcher: "Write", hooks: [{ type: "command", command: "other" }] },
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "tyr judge" }],
					},
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
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-install-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test("creates file and parent directories", async () => {
		const path = join(tempDir, "sub", "dir", "settings.json");
		await writeSettings(path, { test: true });
		const text = await readFile(path, "utf-8");
		expect(JSON.parse(text)).toEqual({ test: true });
	});
});

describe("tyr install (integration)", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-install-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

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
		const { stdout, exitCode } = await runInstall("--global", "--dry-run");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Would write to");
		expect(stdout).toContain("tyr judge");

		// Verify nothing was written
		const settingsPath = join(tempDir, ".claude", "settings.json");
		const file = Bun.file(settingsPath);
		expect(await file.exists()).toBe(false);
	}, { timeout: 10_000 });

	test("installs hook into empty settings", async () => {
		const { stdout, exitCode } = await runInstall("--global");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Installed tyr hook");

		const settingsPath = join(tempDir, ".claude", "settings.json");
		const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
		expect(isInstalled(settings)).toBe(true);
	}, { timeout: 10_000 });

	test("re-install overwrites existing hook", async () => {
		await runInstall("--global");
		const { stdout, exitCode } = await runInstall("--global");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Updated tyr hook");

		// Verify only one tyr entry exists (no duplicates)
		const settingsPath = join(tempDir, ".claude", "settings.json");
		const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
		const permReqs = settings.hooks.PermissionRequest;
		const tyrEntries = permReqs.filter((e: Record<string, unknown>) => {
			const hooks = e.hooks as Record<string, unknown>[];
			return hooks?.some(
				(h) => typeof h.command === "string" && h.command.startsWith("tyr "),
			);
		});
		expect(tyrEntries).toHaveLength(1);
	}, { timeout: 10_000 });

	test("does not clobber existing hooks", async () => {
		const settingsPath = join(tempDir, ".claude", "settings.json");
		await writeSettings(settingsPath, {
			hooks: {
				PermissionRequest: [
					{ matcher: "Write", hooks: [{ type: "command", command: "other" }] },
				],
			},
		});

		await runInstall("--global");

		const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
		const permReqs = settings.hooks.PermissionRequest;
		expect(permReqs).toHaveLength(2);
		expect(permReqs[0].matcher).toBe("Write");
	}, { timeout: 10_000 });
});

describe.concurrent("removeHook", () => {
	test("returns null when tyr is not installed", () => {
		expect(removeHook({})).toBeNull();
	});

	test("returns null for settings with only other hooks", () => {
		expect(
			removeHook({
				hooks: {
					PermissionRequest: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "other-tool" }],
						},
					],
				},
			}),
		).toBeNull();
	});

	test("removes tyr entry and preserves other hooks", () => {
		const result = removeHook({
			hooks: {
				PermissionRequest: [
					{ matcher: "Write", hooks: [{ type: "command", command: "other" }] },
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "tyr judge" }],
					},
				],
			},
		});
		expect(result).not.toBeNull();
		const hooks = result!.hooks as Record<string, unknown>;
		const permReqs = hooks.PermissionRequest as unknown[];
		expect(permReqs).toHaveLength(1);
	});

	test("removes PermissionRequest key when tyr was the only entry", () => {
		const result = removeHook({
			hooks: {
				PermissionRequest: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "tyr judge" }],
					},
				],
			},
		});
		expect(result).not.toBeNull();
		expect(result!.hooks).toBeUndefined();
	});

	test("preserves other hook event types", () => {
		const result = removeHook({
			hooks: {
				PermissionRequest: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "tyr judge" }],
					},
				],
				PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "logger" }] }],
			},
		});
		expect(result).not.toBeNull();
		const hooks = result!.hooks as Record<string, unknown>;
		expect(hooks.PermissionRequest).toBeUndefined();
		expect(hooks.PostToolUse).toBeDefined();
	});

	test("preserves non-hook settings", () => {
		const result = removeHook({
			permissions: { allow: ["ls"] },
			hooks: {
				PermissionRequest: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "tyr judge" }],
					},
				],
			},
		});
		expect(result).not.toBeNull();
		expect(result!.permissions).toEqual({ allow: ["ls"] });
	});
});

describe("tyr uninstall (integration)", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-install-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	async function runCmd(
		cmd: string,
		...args: string[]
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const proc = Bun.spawn(["bun", "run", "src/index.ts", cmd, ...args], {
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

	test("uninstall when not installed exits 0 with message", async () => {
		const { stdout, exitCode } = await runCmd("uninstall", "--global");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("not found");
	}, { timeout: 10_000 });

	test("uninstall after install removes the hook", async () => {
		await runCmd("install", "--global");
		const { stdout, exitCode } = await runCmd("uninstall", "--global");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Removed tyr hook");

		const settingsPath = join(tempDir, ".claude", "settings.json");
		const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
		expect(isInstalled(settings)).toBe(false);
	}, { timeout: 10_000 });

	test("uninstall --dry-run does not modify file", async () => {
		await runCmd("install", "--global");
		const settingsPath = join(tempDir, ".claude", "settings.json");
		const before = await readFile(settingsPath, "utf-8");

		const { stdout, exitCode } = await runCmd(
			"uninstall",
			"--global",
			"--dry-run",
		);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Would write to");

		const after = await readFile(settingsPath, "utf-8");
		expect(after).toBe(before);
	}, { timeout: 10_000 });

	test("uninstall preserves other hooks", async () => {
		const settingsPath = join(tempDir, ".claude", "settings.json");
		await writeSettings(settingsPath, {
			hooks: {
				PermissionRequest: [
					{ matcher: "Write", hooks: [{ type: "command", command: "other" }] },
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "tyr judge" }],
					},
				],
			},
		});

		const { exitCode } = await runCmd("uninstall", "--global");
		expect(exitCode).toBe(0);

		const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
		expect(isInstalled(settings)).toBe(false);
		const hooks = settings.hooks as Record<string, unknown>;
		const permReqs = hooks.PermissionRequest as unknown[];
		expect(permReqs).toHaveLength(1);
		expect((permReqs[0] as Record<string, unknown>).matcher).toBe("Write");
	}, { timeout: 10_000 });
});
