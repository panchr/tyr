import { resolve } from "node:path";

/** Result from running a tyr CLI subprocess. */
export interface CliResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

const PROJECT_ROOT = resolve(import.meta.dir, "../../..");

/** Collect stdout, stderr, and exit code from a piped subprocess. */
async function collectResult(proc: {
	stdout: ReadableStream;
	stderr: ReadableStream;
	exited: Promise<number>;
}): Promise<CliResult> {
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

/** Run `tyr judge` as a subprocess, piping input to stdin. */
export async function runJudge(
	stdin: string,
	options: {
		args?: string[];
		env?: Record<string, string | undefined>;
	} = {},
): Promise<CliResult> {
	const proc = Bun.spawn(
		["bun", "run", "src/index.ts", "judge", ...(options.args ?? [])],
		{
			cwd: PROJECT_ROOT,
			stdout: "pipe",
			stderr: "pipe",
			stdin: new Response(stdin).body,
			env: { ...process.env, ...options.env },
		},
	);
	return collectResult(proc);
}

/** Run an arbitrary tyr subcommand as a subprocess. */
export async function runCli(
	subcommand: string,
	args: string[] = [],
	options: {
		env?: Record<string, string | undefined>;
	} = {},
): Promise<CliResult> {
	const proc = Bun.spawn(["bun", "run", "src/index.ts", subcommand, ...args], {
		cwd: PROJECT_ROOT,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...options.env },
	});
	return collectResult(proc);
}
