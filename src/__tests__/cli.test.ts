import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../version.ts";
import { runCli } from "./helpers/index.ts";

let tempDir: string;

/** Env vars that prevent tests from using production config. */
function isolatedEnv(): Record<string, string> {
	return {
		CLAUDE_CONFIG_DIR: join(tempDir, "empty-config"),
		TYR_CONFIG_FILE: join(tempDir, "tyr-config.json"),
		TYR_DB_PATH: join(tempDir, "tyr.db"),
	};
}

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-cli-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe.concurrent("cli routing", () => {
	test(
		"no args shows usage and exits non-zero",
		async () => {
			const { stdout, exitCode } = await runCli("", [], {
				env: isolatedEnv(),
			});
			expect(stdout).toContain(
				"config|db|debug|install|judge|log|stats|suggest|uninstall|version",
			);
			expect(exitCode).not.toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"--help shows usage and exits 0",
		async () => {
			const { stdout, exitCode } = await runCli("--help", [], {
				env: isolatedEnv(),
			});
			expect(stdout).toContain(
				"config|db|debug|install|judge|log|stats|suggest|uninstall|version",
			);
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"--version prints version",
		async () => {
			const { stdout, exitCode } = await runCli("--version", [], {
				env: isolatedEnv(),
			});
			expect(stdout.trim()).toContain(VERSION);
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"unknown subcommand shows usage",
		async () => {
			const { stdout, exitCode } = await runCli("bogus", [], {
				env: isolatedEnv(),
			});
			expect(stdout).toContain(
				"config|db|debug|install|judge|log|stats|suggest|uninstall|version",
			);
			expect(exitCode).not.toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"judge --help shows judge usage",
		async () => {
			const { stdout, exitCode } = await runCli("judge", ["--help"], {
				env: isolatedEnv(),
			});
			expect(stdout).toContain("--verbose");
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"install --help shows install usage",
		async () => {
			const { stdout, exitCode } = await runCli("install", ["--help"], {
				env: isolatedEnv(),
			});
			expect(stdout).toContain("--global");
			expect(stdout).toContain("--project");
			expect(stdout).toContain("--dry-run");
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"config --help shows config usage",
		async () => {
			const { stdout, exitCode } = await runCli("config", ["--help"], {
				env: isolatedEnv(),
			});
			expect(stdout).toContain("config");
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"log --help shows log usage",
		async () => {
			const { stdout, exitCode } = await runCli("log", ["--help"], {
				env: isolatedEnv(),
			});
			expect(stdout).toContain("--json");
			expect(stdout).toContain("--since");
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"version subcommand prints tyr version",
		async () => {
			const { stdout, exitCode } = await runCli("version", [], {
				env: isolatedEnv(),
			});
			expect(stdout).toContain("tyr ");
			expect(stdout).toContain("bun ");
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"config with no subcommand shows usage",
		async () => {
			const { stderr, exitCode } = await runCli("config", [], {
				env: isolatedEnv(),
			});
			expect(stderr).toContain("No command specified");
			expect(exitCode).not.toBe(0);
		},
		{ timeout: 10_000 },
	);
});
