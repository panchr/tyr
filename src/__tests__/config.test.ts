import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getConfigPath,
	getEnvPath,
	isValidKey,
	loadEnvFile,
	parseValue,
	readConfig,
	readEnvFile,
	stripJsonComments,
	writeConfig,
	writeEnvVar,
} from "../config.ts";
import { DEFAULT_TYR_CONFIG } from "../types.ts";
import { saveEnv } from "./helpers/index.ts";

describe("getConfigPath", () => {
	const restoreEnv = saveEnv("TYR_CONFIG_FILE");

	afterEach(() => {
		restoreEnv();
	});

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
		expect(isValidKey("llmProvider")).toBe(true);
		expect(isValidKey("llmModel")).toBe(true);
		expect(isValidKey("llmEndpoint")).toBe(true);
		expect(isValidKey("llmTimeout")).toBe(true);
		expect(isValidKey("llmCanDeny")).toBe(true);
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

	test("parses string values", () => {
		expect(parseValue("llmProvider", "openrouter")).toBe("openrouter");
		expect(parseValue("llmModel", "anthropic/claude-3.5-haiku")).toBe(
			"anthropic/claude-3.5-haiku",
		);
	});

	test("parses number values", () => {
		expect(parseValue("llmTimeout", "30")).toBe(30);
		expect(parseValue("llmTimeout", "5.5")).toBe(5.5);
	});

	test("returns null for invalid number", () => {
		expect(parseValue("llmTimeout", "abc")).toBeNull();
		expect(parseValue("llmTimeout", "")).toBeNull();
	});
});

describe.concurrent("stripJsonComments", () => {
	test("passes plain JSON through", () => {
		const input = '{"key": "value"}';
		expect(stripJsonComments(input)).toBe(input);
	});

	test("strips single-line comments", () => {
		const input = '{\n  // This is a comment\n  "key": "value"\n}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ key: "value" });
	});

	test("strips block comments", () => {
		const input = '{\n  /* block comment */\n  "key": "value"\n}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ key: "value" });
	});

	test("preserves // inside strings", () => {
		const input = '{"url": "https://example.com"}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({
			url: "https://example.com",
		});
	});

	test("preserves /* inside strings", () => {
		const input = '{"val": "a /* b */ c"}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({
			val: "a /* b */ c",
		});
	});

	test("handles escaped quotes in strings", () => {
		const input = '{"val": "say \\"hello\\""}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({
			val: 'say "hello"',
		});
	});

	test("strips trailing comment after value", () => {
		const input = '{\n  "key": true // enable this\n}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ key: true });
	});

	test("strips multi-line block comment", () => {
		const input = '{\n  /*\n   * multi\n   * line\n   */\n  "key": 1\n}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ key: 1 });
	});
});

describe("readConfig", () => {
	let tempDir: string;
	const restoreEnv = saveEnv("TYR_CONFIG_FILE");

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-config-"));
		process.env.TYR_CONFIG_FILE = join(tempDir, "config.json");
	});

	afterEach(async () => {
		restoreEnv();
		await rm(tempDir, { recursive: true, force: true });
	});

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

	test("reads JSONC config with comments", async () => {
		const path = getConfigPath();
		await Bun.write(
			path,
			'{\n  // Enable fail-open for safety\n  "failOpen": true,\n  /* LLM config */\n  "llmTimeout": 30\n}\n',
		);
		const config = await readConfig();
		expect(config.failOpen).toBe(true);
		expect(config.llmTimeout).toBe(30);
	});
});

describe("writeConfig", () => {
	let tempDir: string;
	const restoreEnv = saveEnv("TYR_CONFIG_FILE");

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-config-"));
		process.env.TYR_CONFIG_FILE = join(tempDir, "config.json");
	});

	afterEach(async () => {
		restoreEnv();
		await rm(tempDir, { recursive: true, force: true });
	});

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

describe("getEnvPath", () => {
	const restoreEnv = saveEnv("TYR_CONFIG_FILE");

	afterEach(() => {
		restoreEnv();
	});

	test("returns .env next to config file", () => {
		process.env.TYR_CONFIG_FILE = "/custom/path/config.json";
		expect(getEnvPath()).toBe("/custom/path/.env");
	});

	test("uses default config dir when no override", () => {
		delete process.env.TYR_CONFIG_FILE;
		expect(getEnvPath()).toMatch(/\.config\/tyr\/\.env$/);
	});
});

describe("loadEnvFile", () => {
	let tempDir: string;
	const restoreConfigEnv = saveEnv("TYR_CONFIG_FILE");

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-env-"));
		process.env.TYR_CONFIG_FILE = join(tempDir, "config.json");
	});

	afterEach(async () => {
		restoreConfigEnv();
		// Clean up any env vars we set
		delete process.env.TEST_LOAD_A;
		delete process.env.TEST_LOAD_B;
		delete process.env.TEST_LOAD_QUOTED;
		delete process.env.TEST_LOAD_SINGLE;
		delete process.env.TEST_LOAD_EMPTY;
		await rm(tempDir, { recursive: true, force: true });
	});

	test("parses KEY=VALUE lines", async () => {
		await Bun.write(
			join(tempDir, ".env"),
			"TEST_LOAD_A=hello\nTEST_LOAD_B=world\n",
		);
		loadEnvFile();
		expect(process.env.TEST_LOAD_A).toBe("hello");
		expect(process.env.TEST_LOAD_B).toBe("world");
	});

	test("skips comments and blank lines", async () => {
		await Bun.write(
			join(tempDir, ".env"),
			"# comment\n\nTEST_LOAD_A=value\n  # indented comment\n",
		);
		loadEnvFile();
		expect(process.env.TEST_LOAD_A).toBe("value");
	});

	test("strips double quotes", async () => {
		await Bun.write(join(tempDir, ".env"), 'TEST_LOAD_QUOTED="hello world"\n');
		loadEnvFile();
		expect(process.env.TEST_LOAD_QUOTED).toBe("hello world");
	});

	test("strips single quotes", async () => {
		await Bun.write(join(tempDir, ".env"), "TEST_LOAD_SINGLE='hello world'\n");
		loadEnvFile();
		expect(process.env.TEST_LOAD_SINGLE).toBe("hello world");
	});

	test("handles empty value", async () => {
		await Bun.write(join(tempDir, ".env"), "TEST_LOAD_EMPTY=\n");
		loadEnvFile();
		expect(process.env.TEST_LOAD_EMPTY).toBe("");
	});

	test("does not overwrite existing env vars", async () => {
		process.env.TEST_LOAD_A = "original";
		await Bun.write(join(tempDir, ".env"), "TEST_LOAD_A=overwritten\n");
		loadEnvFile();
		expect(process.env.TEST_LOAD_A).toBe("original");
	});

	test("no-ops when file does not exist", () => {
		expect(() => loadEnvFile()).not.toThrow();
	});
});

describe("readEnvFile / writeEnvVar", () => {
	let tempDir: string;
	const restoreConfigEnv = saveEnv("TYR_CONFIG_FILE");

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-env-"));
		process.env.TYR_CONFIG_FILE = join(tempDir, "config.json");
	});

	afterEach(async () => {
		restoreConfigEnv();
		await rm(tempDir, { recursive: true, force: true });
	});

	test("readEnvFile returns empty object when file missing", () => {
		expect(readEnvFile()).toEqual({});
	});

	test("writeEnvVar creates new file and readEnvFile reads it back", () => {
		writeEnvVar("MY_KEY", "my_value");
		const vars = readEnvFile();
		expect(vars.MY_KEY).toBe("my_value");
	});

	test("writeEnvVar upserts existing key", () => {
		writeEnvVar("MY_KEY", "first");
		writeEnvVar("MY_KEY", "second");
		const vars = readEnvFile();
		expect(vars.MY_KEY).toBe("second");
	});

	test("writeEnvVar preserves other keys", () => {
		writeEnvVar("KEY_A", "a");
		writeEnvVar("KEY_B", "b");
		const vars = readEnvFile();
		expect(vars.KEY_A).toBe("a");
		expect(vars.KEY_B).toBe("b");
	});

	test("round-trip with multiple keys", () => {
		writeEnvVar("X", "1");
		writeEnvVar("Y", "2");
		writeEnvVar("Z", "3");
		writeEnvVar("Y", "updated");
		const vars = readEnvFile();
		expect(vars).toEqual({ X: "1", Y: "updated", Z: "3" });
	});
});

describe("tyr config CLI (integration)", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-config-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

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

	test(
		"config show prints defaults",
		async () => {
			const { stdout, exitCode } = await runConfig("show");
			expect(exitCode).toBe(0);
			const parsed = JSON.parse(stdout);
			expect(parsed).toEqual(DEFAULT_TYR_CONFIG);
		},
		{ timeout: 10_000 },
	);

	test(
		"config set updates a value",
		async () => {
			const setResult = await runConfig("set", "failOpen", "true");
			expect(setResult.exitCode).toBe(0);
			expect(setResult.stdout).toContain("Set failOpen = true");

			const showResult = await runConfig("show");
			const parsed = JSON.parse(showResult.stdout);
			expect(parsed.failOpen).toBe(true);
		},
		{ timeout: 10_000 },
	);

	test(
		"config set rejects unknown key",
		async () => {
			const { stderr, exitCode } = await runConfig("set", "badKey", "true");
			expect(exitCode).toBe(1);
			expect(stderr).toContain("Unknown config key");
		},
		{ timeout: 10_000 },
	);

	test(
		"config set rejects invalid value",
		async () => {
			const { stderr, exitCode } = await runConfig("set", "failOpen", "maybe");
			expect(exitCode).toBe(1);
			expect(stderr).toContain("Invalid value");
		},
		{ timeout: 10_000 },
	);

	test(
		"config path prints path",
		async () => {
			const { stdout, exitCode } = await runConfig("path");
			expect(exitCode).toBe(0);
			expect(stdout.trim()).toContain("config.json");
		},
		{ timeout: 10_000 },
	);
});
