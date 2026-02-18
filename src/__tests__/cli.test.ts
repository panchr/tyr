import { describe, expect, test } from "bun:test";
import { VERSION } from "../version.ts";
import { runCli } from "./helpers/index.ts";

describe.concurrent("cli routing", () => {
	test(
		"no args shows usage and exits non-zero",
		async () => {
			const { stdout, exitCode } = await runCli("", []);
			expect(stdout).toContain(
				"config|debug|install|judge|log|stats|uninstall|version",
			);
			expect(exitCode).not.toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"--help shows usage and exits 0",
		async () => {
			const { stdout, exitCode } = await runCli("--help");
			expect(stdout).toContain(
				"config|debug|install|judge|log|stats|uninstall|version",
			);
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"--version prints version",
		async () => {
			const { stdout, exitCode } = await runCli("--version");
			expect(stdout.trim()).toContain(VERSION);
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"unknown subcommand shows usage",
		async () => {
			const { stdout, exitCode } = await runCli("bogus");
			expect(stdout).toContain(
				"config|debug|install|judge|log|stats|uninstall|version",
			);
			expect(exitCode).not.toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"judge --help shows judge usage",
		async () => {
			const { stdout, exitCode } = await runCli("judge", ["--help"]);
			expect(stdout).toContain("--verbose");
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"install --help shows install usage",
		async () => {
			const { stdout, exitCode } = await runCli("install", ["--help"]);
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
			const { stdout, exitCode } = await runCli("config", ["--help"]);
			expect(stdout).toContain("config");
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"log --help shows log usage",
		async () => {
			const { stdout, exitCode } = await runCli("log", ["--help"]);
			expect(stdout).toContain("--json");
			expect(stdout).toContain("--since");
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"version subcommand prints tyr version",
		async () => {
			const { stdout, exitCode } = await runCli("version");
			expect(stdout).toContain("tyr ");
			expect(stdout).toContain("bun ");
			expect(exitCode).toBe(0);
		},
		{ timeout: 10_000 },
	);

	test(
		"config with no subcommand shows usage",
		async () => {
			const { stderr, exitCode } = await runCli("config");
			expect(stderr).toContain("No command specified");
			expect(exitCode).not.toBe(0);
		},
		{ timeout: 10_000 },
	);
});
