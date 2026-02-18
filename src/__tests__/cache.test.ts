import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgent } from "../agents/claude.ts";
import { checkCache, computeConfigHash, writeCache } from "../cache.ts";
import { getDb, resetDbInstance } from "../db.ts";
import { readLogEntries } from "../log.ts";
import type { PermissionRequest, TyrConfig } from "../types.ts";
import { saveEnv } from "./helpers/index.ts";

const restoreDbEnv = saveEnv("TYR_DB_PATH");

let tempDir: string;

afterEach(async () => {
	resetDbInstance();
	restoreDbEnv();
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = "";
	}
});

async function setupTempDb(): Promise<void> {
	tempDir = await mkdtemp(join(tmpdir(), "tyr-cache-test-"));
	process.env.TYR_DB_PATH = join(tempDir, "tyr.db");
}

function makeReq(
	overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
	return {
		session_id: "test-session",
		transcript_path: "/path/to/transcript.jsonl",
		cwd: "/test/project",
		permission_mode: "default",
		hook_event_name: "PermissionRequest",
		tool_name: "Bash",
		tool_input: { command: "echo hello" },
		...overrides,
	};
}

function makeConfig(
	overrides: Partial<Omit<TyrConfig, "llm">> & {
		llm?: Partial<TyrConfig["llm"]>;
	} = {},
): TyrConfig {
	const { llm: llmOverrides, ...rest } = overrides;
	return {
		allowChainedCommands: true,
		allowPromptChecks: false,
		cacheChecks: true,
		failOpen: false,
		llm: {
			provider: "claude",
			model: "haiku",
			endpoint: "https://openrouter.ai/api/v1",
			timeout: 10,
			canDeny: false,
			...llmOverrides,
		},
		verboseLog: false,
		...rest,
	};
}

describe("computeConfigHash", () => {
	test("produces consistent hash for same inputs", () => {
		const agent = new ClaudeAgent();
		const config = makeConfig();
		const hash1 = computeConfigHash(agent, config);
		const hash2 = computeConfigHash(agent, config);
		expect(hash1).toBe(hash2);
		expect(hash1).toMatch(/^[a-f0-9]{64}$/);
	});

	test("changes when config values change", () => {
		const agent = new ClaudeAgent();
		const hash1 = computeConfigHash(
			agent,
			makeConfig({ llm: { model: "haiku" } }),
		);
		const hash2 = computeConfigHash(
			agent,
			makeConfig({ llm: { model: "sonnet" } }),
		);
		expect(hash1).not.toBe(hash2);
	});

	test("changes when llmCanDeny changes", () => {
		const agent = new ClaudeAgent();
		const hash1 = computeConfigHash(
			agent,
			makeConfig({ llm: { canDeny: false } }),
		);
		const hash2 = computeConfigHash(
			agent,
			makeConfig({ llm: { canDeny: true } }),
		);
		expect(hash1).not.toBe(hash2);
	});

	test("ignores fields not relevant to decisions", () => {
		const agent = new ClaudeAgent();
		const hash1 = computeConfigHash(
			agent,
			makeConfig({ llm: { timeout: 10 } }),
		);
		const hash2 = computeConfigHash(
			agent,
			makeConfig({ llm: { timeout: 30 } }),
		);
		// llmTimeout isn't in the hash — same hash
		expect(hash1).toBe(hash2);
	});
});

describe("checkCache / writeCache", () => {
	test("returns null on cache miss", async () => {
		await setupTempDb();
		const req = makeReq();
		const hit = checkCache(req, "somehash");
		expect(hit).toBeNull();
	});

	test("round-trips an allow decision", async () => {
		await setupTempDb();
		const req = makeReq();
		const hash = "testhash123";

		writeCache(req, "allow", "chained-commands", undefined, hash);
		const hit = checkCache(req, hash);

		expect(hit).not.toBeNull();
		expect(hit?.decision).toBe("allow");
		expect(hit?.provider).toBe("chained-commands");
		expect(hit?.reason).toBeNull();
	});

	test("round-trips a deny decision with reason", async () => {
		await setupTempDb();
		const req = makeReq();
		const hash = "testhash123";

		writeCache(req, "deny", "llm", "dangerous command", hash);
		const hit = checkCache(req, hash);

		expect(hit).not.toBeNull();
		expect(hit?.decision).toBe("deny");
		expect(hit?.provider).toBe("llm");
		expect(hit?.reason).toBe("dangerous command");
	});

	test("different tool_name does not collide", async () => {
		await setupTempDb();
		const hash = "samehash";

		writeCache(makeReq({ tool_name: "Bash" }), "allow", "p1", undefined, hash);
		writeCache(makeReq({ tool_name: "Write" }), "deny", "p2", undefined, hash);

		const hit1 = checkCache(makeReq({ tool_name: "Bash" }), hash);
		const hit2 = checkCache(makeReq({ tool_name: "Write" }), hash);

		expect(hit1?.decision).toBe("allow");
		expect(hit2?.decision).toBe("deny");
	});

	test("different tool_input does not collide", async () => {
		await setupTempDb();
		const hash = "samehash";

		writeCache(
			makeReq({ tool_input: { command: "echo a" } }),
			"allow",
			"p1",
			undefined,
			hash,
		);
		writeCache(
			makeReq({ tool_input: { command: "echo b" } }),
			"deny",
			"p2",
			undefined,
			hash,
		);

		const hit1 = checkCache(
			makeReq({ tool_input: { command: "echo a" } }),
			hash,
		);
		const hit2 = checkCache(
			makeReq({ tool_input: { command: "echo b" } }),
			hash,
		);

		expect(hit1?.decision).toBe("allow");
		expect(hit2?.decision).toBe("deny");
	});

	test("different cwd does not collide", async () => {
		await setupTempDb();
		const hash = "samehash";

		writeCache(makeReq({ cwd: "/project/a" }), "allow", "p1", undefined, hash);
		writeCache(makeReq({ cwd: "/project/b" }), "deny", "p2", undefined, hash);

		const hit1 = checkCache(makeReq({ cwd: "/project/a" }), hash);
		const hit2 = checkCache(makeReq({ cwd: "/project/b" }), hash);

		expect(hit1?.decision).toBe("allow");
		expect(hit2?.decision).toBe("deny");
	});

	test("config_hash mismatch returns null", async () => {
		await setupTempDb();
		const req = makeReq();

		writeCache(req, "allow", "p1", undefined, "hash-v1");
		const hit = checkCache(req, "hash-v2");

		expect(hit).toBeNull();
	});

	test("different config_hash entries coexist", async () => {
		await setupTempDb();
		const req = makeReq();

		writeCache(req, "allow", "p1", undefined, "hash-v1");
		writeCache(req, "deny", "p2", "new config", "hash-v2");

		const hit1 = checkCache(req, "hash-v1");
		const hit2 = checkCache(req, "hash-v2");

		expect(hit1?.decision).toBe("allow");
		expect(hit2?.decision).toBe("deny");
		expect(hit2?.reason).toBe("new config");
	});

	test("INSERT OR REPLACE overwrites same config_hash entry", async () => {
		await setupTempDb();
		const req = makeReq();
		const hash = "samehash";

		writeCache(req, "allow", "p1", undefined, hash);
		writeCache(req, "deny", "p2", "now denied", hash);

		const hit = checkCache(req, hash);
		expect(hit?.decision).toBe("deny");
		expect(hit?.provider).toBe("p2");
		expect(hit?.reason).toBe("now denied");
	});

	test("extracts Bash command for tool_input key", async () => {
		await setupTempDb();
		const req = makeReq({
			tool_name: "Bash",
			tool_input: { command: "rm -rf /tmp/test" },
		});
		const hash = "testhash";

		writeCache(req, "deny", "llm", "destructive", hash);

		// Same command should hit
		const hit = checkCache(req, hash);
		expect(hit?.decision).toBe("deny");

		// Different command should miss
		const hit2 = checkCache(
			makeReq({
				tool_name: "Bash",
				tool_input: { command: "ls /tmp" },
			}),
			hash,
		);
		expect(hit2).toBeNull();
	});
});

describe("cache integration (judge)", () => {
	test(
		"judge writes cache entry with --cache-checks --fail-open",
		async () => {
			await setupTempDb();
			const dbPath = join(tempDir, "tyr.db");

			const req = {
				session_id: "cache-test",
				transcript_path: "/path/to/transcript.jsonl",
				cwd: "/test/dir",
				permission_mode: "default",
				hook_event_name: "PermissionRequest",
				tool_name: "Bash",
				tool_input: { command: "echo cached" },
			};

			// Run with --fail-open so pipeline produces an allow (fail-open on abstain)
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					"src/index.ts",
					"judge",
					"--cache-checks",
					"--fail-open",
				],
				{
					cwd: `${import.meta.dir}/../..`,
					stdout: "pipe",
					stderr: "pipe",
					stdin: new Response(JSON.stringify(req)).body,
					env: {
						...process.env,
						TYR_DB_PATH: dbPath,
						CLAUDE_CONFIG_DIR: join(tempDir, "empty-config"),
						TYR_CONFIG_FILE: join(tempDir, "tyr-config.json"),
					},
				},
			);
			expect(await proc.exited).toBe(0);

			// Verify a cache row was written
			const db = getDb();
			const row = db
				.query("SELECT decision, provider FROM cache WHERE tool_name = ?")
				.get("Bash") as { decision: string; provider: string } | null;
			expect(row).not.toBeNull();
			expect(row?.decision).toBe("allow");
			expect(row?.provider).toBe("fail-open");

			// Verify log entry was written
			const entries = readLogEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0]?.decision).toBe("allow");
		},
		{ timeout: 10_000 },
	);

	test(
		"second run hits cache (cached=1 in log)",
		async () => {
			await setupTempDb();
			const dbPath = join(tempDir, "tyr.db");

			const req = {
				session_id: "cache-test-2",
				transcript_path: "/path/to/transcript.jsonl",
				cwd: "/test/dir",
				permission_mode: "default",
				hook_event_name: "PermissionRequest",
				tool_name: "Bash",
				tool_input: { command: "echo cached2" },
			};

			const spawnOpts = {
				cwd: `${import.meta.dir}/../..`,
				stdout: "pipe" as const,
				stderr: "pipe" as const,
				env: {
					...process.env,
					TYR_DB_PATH: dbPath,
					CLAUDE_CONFIG_DIR: join(tempDir, "empty-config"),
					TYR_CONFIG_FILE: join(tempDir, "tyr-config.json"),
				},
			};

			// First run — populates cache
			const proc1 = Bun.spawn(
				[
					"bun",
					"run",
					"src/index.ts",
					"judge",
					"--cache-checks",
					"--fail-open",
				],
				{
					...spawnOpts,
					stdin: new Response(JSON.stringify(req)).body,
				},
			);
			expect(await proc1.exited).toBe(0);

			// Second run — should hit cache
			const proc2 = Bun.spawn(
				[
					"bun",
					"run",
					"src/index.ts",
					"judge",
					"--cache-checks",
					"--fail-open",
				],
				{
					...spawnOpts,
					stdin: new Response(JSON.stringify(req)).body,
				},
			);
			expect(await proc2.exited).toBe(0);

			// Verify second log entry has cached=1
			const entries = readLogEntries();
			expect(entries).toHaveLength(2);
			expect(entries[1]?.cached).toBe(1);
			expect(entries[1]?.decision).toBe("allow");
		},
		{ timeout: 15_000 },
	);
});
