import { describe, expect, test } from "bun:test";
import { parsePermissionRequest } from "../judge.ts";

const VALID_REQUEST = {
	session_id: "abc123",
	transcript_path: "/path/to/transcript.jsonl",
	cwd: "/working/directory",
	permission_mode: "default",
	hook_event_name: "PermissionRequest",
	tool_name: "Bash",
	tool_input: {
		command: "bun test | less",
		description: "Run tests and page output",
	},
};

describe.concurrent("parsePermissionRequest", () => {
	test("accepts valid PermissionRequest", () => {
		const req = parsePermissionRequest(VALID_REQUEST);
		expect(req).not.toBeNull();
		expect(req?.tool_name).toBe("Bash");
	});

	test("rejects null", () => {
		expect(parsePermissionRequest(null)).toBeNull();
	});

	test("rejects non-object", () => {
		expect(parsePermissionRequest("string")).toBeNull();
		expect(parsePermissionRequest(42)).toBeNull();
	});

	test("rejects missing session_id", () => {
		const { session_id, ...rest } = VALID_REQUEST;
		expect(parsePermissionRequest(rest)).toBeNull();
	});

	test("rejects missing tool_name", () => {
		const { tool_name, ...rest } = VALID_REQUEST;
		expect(parsePermissionRequest(rest)).toBeNull();
	});

	test("rejects missing tool_input", () => {
		const { tool_input, ...rest } = VALID_REQUEST;
		expect(parsePermissionRequest(rest)).toBeNull();
	});

	test("rejects wrong hook_event_name", () => {
		expect(
			parsePermissionRequest({
				...VALID_REQUEST,
				hook_event_name: "SomethingElse",
			}),
		).toBeNull();
	});

	test("rejects null tool_input", () => {
		expect(
			parsePermissionRequest({ ...VALID_REQUEST, tool_input: null }),
		).toBeNull();
	});

	test("rejects missing cwd", () => {
		const { cwd, ...rest } = VALID_REQUEST;
		expect(parsePermissionRequest(rest)).toBeNull();
	});

	test("rejects missing transcript_path", () => {
		const { transcript_path, ...rest } = VALID_REQUEST;
		expect(parsePermissionRequest(rest)).toBeNull();
	});

	test("rejects missing permission_mode", () => {
		const { permission_mode, ...rest } = VALID_REQUEST;
		expect(parsePermissionRequest(rest)).toBeNull();
	});

	test("accepts extra fields", () => {
		const req = parsePermissionRequest({
			...VALID_REQUEST,
			extra_field: "should be fine",
		});
		expect(req).not.toBeNull();
		expect(req?.tool_name).toBe("Bash");
	});

	test("rejects non-string session_id", () => {
		expect(
			parsePermissionRequest({ ...VALID_REQUEST, session_id: 123 }),
		).toBeNull();
	});

	test("rejects missing hook_event_name", () => {
		const { hook_event_name, ...rest } = VALID_REQUEST;
		expect(parsePermissionRequest(rest)).toBeNull();
	});
});

/** Run `tyr judge` as a subprocess, piping input to stdin. */
async function runJudge(
	stdin: string,
	extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(
		["bun", "run", "src/index.ts", "judge", ...extraArgs],
		{
			cwd: `${import.meta.dir}/../..`,
			stdout: "pipe",
			stderr: "pipe",
			stdin: new Response(stdin).body,
		},
	);
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

describe.concurrent("tyr judge (integration)", () => {
	test(
		"valid request -> exit 0, empty stdout (fall-through)",
		async () => {
			const { stdout, exitCode } = await runJudge(
				JSON.stringify(VALID_REQUEST),
			);
			expect(exitCode).toBe(0);
			expect(stdout.trim()).toBe("");
		},
		{ timeout: 10_000 },
	);

	test(
		"malformed JSON -> exit 2",
		async () => {
			const { exitCode } = await runJudge("not json{{{");
			expect(exitCode).toBe(2);
		},
		{ timeout: 10_000 },
	);

	test(
		"valid JSON but wrong shape -> exit 2",
		async () => {
			const { exitCode } = await runJudge(JSON.stringify({ foo: "bar" }));
			expect(exitCode).toBe(2);
		},
		{ timeout: 10_000 },
	);

	test(
		"empty stdin -> exit 2",
		async () => {
			const { exitCode } = await runJudge("");
			expect(exitCode).toBe(2);
		},
		{ timeout: 10_000 },
	);

	test(
		"--verbose emits debug info to stderr",
		async () => {
			const { stderr, exitCode } = await runJudge(
				JSON.stringify(VALID_REQUEST),
				["--verbose"],
			);
			expect(exitCode).toBe(0);
			expect(stderr).toContain("[tyr]");
			expect(stderr).toContain("tool=Bash");
		},
		{ timeout: 10_000 },
	);

	test(
		"--verbose on malformed input shows error on stderr",
		async () => {
			const { stderr, exitCode } = await runJudge("{bad", ["--verbose"]);
			expect(exitCode).toBe(2);
			expect(stderr).toContain("[tyr]");
		},
		{ timeout: 10_000 },
	);

	test(
		"rejects unknown flags",
		async () => {
			const { stderr, exitCode } = await runJudge(
				JSON.stringify(VALID_REQUEST),
				["--bogus"],
			);
			expect(exitCode).toBe(1);
			expect(stderr).toContain("Unknown option: --bogus");
		},
		{ timeout: 10_000 },
	);

	test(
		"--shadow suppresses stdout output",
		async () => {
			const { stdout, exitCode } = await runJudge(
				JSON.stringify(VALID_REQUEST),
				["--shadow"],
			);
			expect(exitCode).toBe(0);
			expect(stdout.trim()).toBe("");
		},
		{ timeout: 10_000 },
	);

	test(
		"--shadow with --verbose shows suppression message",
		async () => {
			const { stdout, stderr, exitCode } = await runJudge(
				JSON.stringify(VALID_REQUEST),
				["--shadow", "--verbose"],
			);
			expect(exitCode).toBe(0);
			expect(stdout.trim()).toBe("");
			expect(stderr).toContain("shadow mode: suppressing decision=");
		},
		{ timeout: 10_000 },
	);
});
