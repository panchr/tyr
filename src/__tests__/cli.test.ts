import { describe, expect, test } from "bun:test";

/** Run the CLI as a subprocess and capture output. */
async function runCli(
	...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
		cwd: `${import.meta.dir}/../..`,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

describe.concurrent("cli routing", () => {
	test("no args shows usage and exits non-zero", async () => {
		const { stdout, exitCode } = await runCli();
		expect(stdout).toContain("config|debug|install|judge|log|uninstall|version");
		expect(exitCode).not.toBe(0);
	});

	test("--help shows usage and exits 0", async () => {
		const { stdout, exitCode } = await runCli("--help");
		expect(stdout).toContain("config|debug|install|judge|log|uninstall|version");
		expect(exitCode).toBe(0);
	});

	test("--version prints version", async () => {
		const { stdout, exitCode } = await runCli("--version");
		expect(stdout.trim()).toContain("0.1.0");
		expect(exitCode).toBe(0);
	});

	test("unknown subcommand shows usage", async () => {
		const { stdout, exitCode } = await runCli("bogus");
		expect(stdout).toContain("config|debug|install|judge|log|uninstall|version");
		expect(exitCode).not.toBe(0);
	});

	test("judge --help shows judge usage", async () => {
		const { stdout, exitCode } = await runCli("judge", "--help");
		expect(stdout).toContain("--verbose");
		expect(exitCode).toBe(0);
	});

	test("install --help shows install usage", async () => {
		const { stdout, exitCode } = await runCli("install", "--help");
		expect(stdout).toContain("--global");
		expect(stdout).toContain("--project");
		expect(stdout).toContain("--dry-run");
		expect(exitCode).toBe(0);
	});

	test("config --help shows config usage", async () => {
		const { stdout, exitCode } = await runCli("config", "--help");
		expect(stdout).toContain("config");
		expect(exitCode).toBe(0);
	});

	test("log --help shows log usage", async () => {
		const { stdout, exitCode } = await runCli("log", "--help");
		expect(stdout).toContain("--json");
		expect(stdout).toContain("--follow");
		expect(exitCode).toBe(0);
	});

	test("version subcommand prints tyr version", async () => {
		const { stdout, exitCode } = await runCli("version");
		expect(stdout).toContain("tyr ");
		expect(stdout).toContain("bun ");
		expect(exitCode).toBe(0);
	});

	test("config with no subcommand shows usage", async () => {
		const { stderr, exitCode } = await runCli("config");
		expect(stderr).toContain("No command specified");
		expect(exitCode).not.toBe(0);
	});
});
