import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ClaudeAgent,
	extractBashPatterns,
	matchPattern,
	settingsPaths,
} from "../agents/claude.ts";
import { saveEnv } from "./helpers/index.ts";

/** Build an isolated paths array using only files under tempDir. */
function testPaths(tempDir: string): string[] {
	return [
		join(tempDir, ".claude", "settings.local.json"),
		join(tempDir, ".claude", "settings.json"),
	];
}

describe.concurrent("extractBashPatterns", () => {
	test("extracts pattern from Bash(specifier)", () => {
		expect(extractBashPatterns(["Bash(npm run *)"])).toEqual(["npm run *"]);
	});

	test("bare Bash becomes wildcard", () => {
		expect(extractBashPatterns(["Bash"])).toEqual(["*"]);
	});

	test("ignores non-Bash rules", () => {
		expect(
			extractBashPatterns(["Read", "Edit(src/*)", "WebFetch(https://*)"]),
		).toEqual([]);
	});

	test("handles mixed rules", () => {
		expect(
			extractBashPatterns([
				"Bash(git *)",
				"Read",
				"Bash",
				"Edit(src/*)",
				"Bash(npm test)",
			]),
		).toEqual(["git *", "*", "npm test"]);
	});

	test("ignores non-string entries", () => {
		expect(
			extractBashPatterns([42, null, undefined, { tool: "Bash" }]),
		).toEqual([]);
	});
});

describe.concurrent("matchPattern", () => {
	test("exact match", () => {
		expect(matchPattern("npm test", "npm test")).toBe(true);
	});

	test("wildcard at end", () => {
		expect(matchPattern("git *", "git push")).toBe(true);
		expect(matchPattern("git *", "git commit -m 'msg'")).toBe(true);
	});

	test("wildcard matches everything", () => {
		expect(matchPattern("*", "anything goes")).toBe(true);
	});

	test("no match", () => {
		expect(matchPattern("npm test", "npm run build")).toBe(false);
	});

	test("wildcard in middle", () => {
		expect(matchPattern("npm * --verbose", "npm test --verbose")).toBe(true);
		expect(matchPattern("npm * --verbose", "npm test --quiet")).toBe(false);
	});

	test("escapes regex special characters", () => {
		expect(matchPattern("echo hello.world", "echo hello.world")).toBe(true);
		expect(matchPattern("echo hello.world", "echo helloXworld")).toBe(false);
	});

	test("consecutive wildcards are collapsed to avoid ReDoS", () => {
		expect(matchPattern("git **", "git push")).toBe(true);
		expect(matchPattern("*****", "anything")).toBe(true);
		// Should complete quickly (no catastrophic backtracking)
		expect(matchPattern("*****", "a".repeat(100))).toBe(true);
	});
});

describe("isCommandAllowed", () => {
	let tempDir: string;
	let agent: ClaudeAgent;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-claude-agent-"));
		agent = new ClaudeAgent();
	});

	afterEach(async () => {
		agent.close();
		await rm(tempDir, { recursive: true, force: true });
	});

	test("deny beats allow", async () => {
		const settingsDir = join(tempDir, ".claude");
		await mkdir(settingsDir, { recursive: true });
		await writeFile(
			join(settingsDir, "settings.json"),
			JSON.stringify({
				permissions: {
					allow: ["Bash(git *)"],
					deny: ["Bash(git push *)"],
				},
			}),
		);

		await agent.init(tempDir, testPaths(tempDir));

		expect(agent.isCommandAllowed("git push origin main")).toBe("deny");
		expect(agent.isCommandAllowed("git status")).toBe("allow");
	});

	test("unknown when no match", async () => {
		const settingsDir = join(tempDir, ".claude");
		await mkdir(settingsDir, { recursive: true });
		await writeFile(
			join(settingsDir, "settings.json"),
			JSON.stringify({
				permissions: {
					allow: ["Bash(git *)"],
				},
			}),
		);

		await agent.init(tempDir, testPaths(tempDir));

		expect(agent.isCommandAllowed("rm -rf /")).toBe("unknown");
	});

	test("precedence: local deny overrides global allow", async () => {
		const projectDir = join(tempDir, ".claude");
		await mkdir(projectDir, { recursive: true });

		// Project shared settings: allow git
		await writeFile(
			join(projectDir, "settings.json"),
			JSON.stringify({
				permissions: {
					allow: ["Bash(git *)"],
				},
			}),
		);

		// Local project settings: deny git push
		await writeFile(
			join(projectDir, "settings.local.json"),
			JSON.stringify({
				permissions: {
					deny: ["Bash(git push *)"],
				},
			}),
		);

		await agent.init(tempDir, testPaths(tempDir));

		expect(agent.isCommandAllowed("git push origin main")).toBe("deny");
		expect(agent.isCommandAllowed("git status")).toBe("allow");
	});
});

describe("init with settings files", () => {
	let tempDir: string;
	let agent: ClaudeAgent;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-claude-init-"));
		agent = new ClaudeAgent();
	});

	afterEach(async () => {
		agent.close();
		await rm(tempDir, { recursive: true, force: true });
	});

	test("loads permissions from settings file", async () => {
		const settingsDir = join(tempDir, ".claude");
		await mkdir(settingsDir, { recursive: true });
		await writeFile(
			join(settingsDir, "settings.json"),
			JSON.stringify({
				permissions: {
					allow: ["Bash(npm test)", "Bash(npm run lint)"],
					deny: ["Bash(rm *)"],
				},
			}),
		);

		await agent.init(tempDir, testPaths(tempDir));

		expect(agent.isCommandAllowed("npm test")).toBe("allow");
		expect(agent.isCommandAllowed("npm run lint")).toBe("allow");
		expect(agent.isCommandAllowed("rm -rf /")).toBe("deny");
		expect(agent.isCommandAllowed("curl example.com")).toBe("unknown");
	});

	test("works with no settings files", async () => {
		await agent.init(tempDir, testPaths(tempDir));

		expect(agent.isCommandAllowed("anything")).toBe("unknown");
	});
});

describe("CLAUDE_CONFIG_DIR", () => {
	let tempDir: string;
	let agent: ClaudeAgent;
	const restoreEnv = saveEnv("CLAUDE_CONFIG_DIR");

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-claude-configdir-"));
		agent = new ClaudeAgent();
	});

	afterEach(async () => {
		agent.close();
		restoreEnv();
		await rm(tempDir, { recursive: true, force: true });
	});

	test("uses CLAUDE_CONFIG_DIR for user settings path", () => {
		process.env.CLAUDE_CONFIG_DIR = "/custom/claude";
		const paths = settingsPaths("/some/project");
		expect(paths).toContain("/custom/claude/settings.json");
	});

	test("loads from custom config dir", async () => {
		const customConfigDir = join(tempDir, "custom-claude");
		await mkdir(customConfigDir, { recursive: true });
		const settingsPath = join(customConfigDir, "settings.json");
		await writeFile(
			settingsPath,
			JSON.stringify({
				permissions: {
					allow: ["Bash(echo *)"],
				},
			}),
		);

		await agent.init(tempDir, [settingsPath]);

		expect(agent.isCommandAllowed("echo hello")).toBe("allow");
	});
});

describe("watcher", () => {
	let tempDir: string;
	let agent: ClaudeAgent;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "tyr-claude-watch-"));
		agent = new ClaudeAgent();
	});

	afterEach(async () => {
		agent.close();
		await rm(tempDir, { recursive: true, force: true });
	});

	test("file change triggers config reload", async () => {
		const settingsDir = join(tempDir, ".claude");
		await mkdir(settingsDir, { recursive: true });
		const settingsPath = join(settingsDir, "settings.json");
		await writeFile(
			settingsPath,
			JSON.stringify({
				permissions: {
					allow: ["Bash(git *)"],
				},
			}),
		);

		await agent.init(tempDir, [settingsPath]);
		expect(agent.isCommandAllowed("git status")).toBe("allow");
		expect(agent.isCommandAllowed("npm test")).toBe("unknown");

		// Update the file
		await writeFile(
			settingsPath,
			JSON.stringify({
				permissions: {
					allow: ["Bash(git *)", "Bash(npm test)"],
				},
			}),
		);

		// Wait for the watcher to fire and reload
		await new Promise((resolve) => setTimeout(resolve, 200));

		expect(agent.isCommandAllowed("npm test")).toBe("allow");
	});
});
