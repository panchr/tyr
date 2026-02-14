import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getConfigPath,
	isValidKey,
	parseValue,
	readConfig,
	writeConfig,
} from "../config.ts";
import { DEFAULT_TYR_CONFIG } from "../types.ts";

let tempDir: string;
const originalEnv = process.env.TYR_CONFIG_FILE;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-config-"));
	process.env.TYR_CONFIG_FILE = join(tempDir, "config.json");
});

afterEach(async () => {
	if (originalEnv === undefined) {
		delete process.env.TYR_CONFIG_FILE;
	} else {
		process.env.TYR_CONFIG_FILE = originalEnv;
	}
	await rm(tempDir, { recursive: true, force: true });
});

describe("getConfigPath", () => {
	test("uses TYR_CONFIG_FILE env var", () => {
		process.env.TYR_CONFIG_FILE = "/custom/path/config.json";
		expect(getConfigPath()).toBe("/custom/path/config.json");
	});
});

describe.concurrent("isValidKey", () => {
	test("accepts valid keys", () => {
		expect(isValidKey("allowChainedCommands")).toBe(true);
		expect(isValidKey("failOpen")).toBe(true);
		expect(isValidKey("allowPromptChecks")).toBe(true);
		expect(isValidKey("cacheChecks")).toBe(true);
	});

	test("rejects invalid keys", () => {
		expect(isValidKey("notARealKey")).toBe(false);
		expect(isValidKey("")).toBe(false);
	});
});

describe.concurrent("parseValue", () => {
	test("parses boolean true", () => {
		expect(parseValue("failOpen", "true")).toBe(true);
	});

	test("parses boolean false", () => {
		expect(parseValue("failOpen", "false")).toBe(false);
	});

	test("returns null for invalid boolean", () => {
		expect(parseValue("failOpen", "yes")).toBeNull();
		expect(parseValue("failOpen", "1")).toBeNull();
	});
});

describe("readConfig", () => {
	test("returns defaults when file missing", async () => {
		const config = await readConfig();
		expect(config).toEqual(DEFAULT_TYR_CONFIG);
	});

	test("reads existing config", async () => {
		await writeConfig({ ...DEFAULT_TYR_CONFIG, failOpen: true });
		const config = await readConfig();
		expect(config.failOpen).toBe(true);
	});

	test("fills missing keys with defaults", async () => {
		const path = getConfigPath();
		await Bun.write(path, JSON.stringify({ failOpen: true }));
		const config = await readConfig();
		expect(config.failOpen).toBe(true);
		expect(config.allowChainedCommands).toBe(
			DEFAULT_TYR_CONFIG.allowChainedCommands,
		);
	});
});

describe("writeConfig", () => {
	test("creates file and parent directories", async () => {
		const config = { ...DEFAULT_TYR_CONFIG, failOpen: true };
		await writeConfig(config);
		const text = await readFile(getConfigPath(), "utf-8");
		const parsed = JSON.parse(text);
		expect(parsed.failOpen).toBe(true);
	});

	test("round-trips with readConfig", async () => {
		const config = { ...DEFAULT_TYR_CONFIG, cacheChecks: true };
		await writeConfig(config);
		const read = await readConfig();
		expect(read).toEqual(config);
	});
});

describe("tyr config CLI (integration)", () => {
	async function runConfig(
		...args: string[]
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const proc = Bun.spawn(["bun", "run", "src/index.ts", "config", ...args], {
			cwd: `${import.meta.dir}/../..`,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				TYR_CONFIG_FILE: join(tempDir, "config.json"),
			},
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		return { stdout, stderr, exitCode };
	}

	test("config show prints defaults", async () => {
		const { stdout, exitCode } = await runConfig("show");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed).toEqual(DEFAULT_TYR_CONFIG);
	});

	test("config set updates a value", async () => {
		const setResult = await runConfig("set", "failOpen", "true");
		expect(setResult.exitCode).toBe(0);
		expect(setResult.stdout).toContain("Set failOpen = true");

		const showResult = await runConfig("show");
		const parsed = JSON.parse(showResult.stdout);
		expect(parsed.failOpen).toBe(true);
	});

	test("config set rejects unknown key", async () => {
		const { stderr, exitCode } = await runConfig("set", "badKey", "true");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Unknown config key");
	});

	test("config set rejects invalid value", async () => {
		const { stderr, exitCode } = await runConfig("set", "failOpen", "maybe");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Invalid value");
	});

	test("config path prints path", async () => {
		const { stdout, exitCode } = await runConfig("path");
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toContain("config.json");
	});
});
