import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatTranscriptForPrompt,
	readTranscript,
	type TranscriptMessage,
} from "../transcript.ts";

async function writeTempTranscript(lines: unknown[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "tyr-transcript-test-"));
	const path = join(dir, "transcript.jsonl");
	await writeFile(
		path,
		lines.map((l) => JSON.stringify(l)).join("\n"),
		"utf-8",
	);
	return path;
}

describe.concurrent("readTranscript", () => {
	test("returns empty array for missing file", async () => {
		const result = await readTranscript("/nonexistent/path.jsonl", 10);
		expect(result).toEqual([]);
	});

	test("parses user messages with string content", async () => {
		const path = await writeTempTranscript([
			{
				type: "user",
				message: { role: "user", content: "Hello world" },
			},
		]);
		try {
			const result = await readTranscript(path, 10);
			expect(result).toEqual([{ role: "user", content: "Hello world" }]);
		} finally {
			await rm(join(path, ".."), { recursive: true, force: true });
		}
	});

	test("parses assistant messages with text content blocks", async () => {
		const path = await writeTempTranscript([
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "Part one." },
						{ type: "text", text: "Part two." },
					],
				},
			},
		]);
		try {
			const result = await readTranscript(path, 10);
			expect(result).toEqual([
				{ role: "assistant", content: "Part one.\nPart two." },
			]);
		} finally {
			await rm(join(path, ".."), { recursive: true, force: true });
		}
	});

	test("skips tool_use and thinking content blocks", async () => {
		const path = await writeTempTranscript([
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "hmm..." },
						{ type: "tool_use", name: "Read", input: {} },
						{ type: "text", text: "The answer is 42." },
					],
				},
			},
		]);
		try {
			const result = await readTranscript(path, 10);
			expect(result).toHaveLength(1);
			expect(result[0]?.content).toBe("The answer is 42.");
		} finally {
			await rm(join(path, ".."), { recursive: true, force: true });
		}
	});

	test("skips assistant messages with no text blocks", async () => {
		const path = await writeTempTranscript([
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "tool_use", name: "Bash", input: {} }],
				},
			},
		]);
		try {
			const result = await readTranscript(path, 10);
			expect(result).toEqual([]);
		} finally {
			await rm(join(path, ".."), { recursive: true, force: true });
		}
	});

	test("skips file-history-snapshot and progress entries", async () => {
		const path = await writeTempTranscript([
			{ type: "file-history-snapshot", data: {} },
			{ type: "progress", message: "Working..." },
			{
				type: "user",
				message: { role: "user", content: "Real message" },
			},
		]);
		try {
			const result = await readTranscript(path, 10);
			expect(result).toEqual([{ role: "user", content: "Real message" }]);
		} finally {
			await rm(join(path, ".."), { recursive: true, force: true });
		}
	});

	test("skips sidechain entries", async () => {
		const path = await writeTempTranscript([
			{
				type: "user",
				isSidechain: true,
				message: { role: "user", content: "Sidechain msg" },
			},
			{
				type: "user",
				message: { role: "user", content: "Main msg" },
			},
		]);
		try {
			const result = await readTranscript(path, 10);
			expect(result).toEqual([{ role: "user", content: "Main msg" }]);
		} finally {
			await rm(join(path, ".."), { recursive: true, force: true });
		}
	});

	test("skips meta entries", async () => {
		const path = await writeTempTranscript([
			{
				type: "user",
				isMeta: true,
				message: { role: "user", content: "System notice" },
			},
			{
				type: "user",
				message: { role: "user", content: "User msg" },
			},
		]);
		try {
			const result = await readTranscript(path, 10);
			expect(result).toEqual([{ role: "user", content: "User msg" }]);
		} finally {
			await rm(join(path, ".."), { recursive: true, force: true });
		}
	});

	test("returns only last N messages", async () => {
		const lines = [];
		for (let i = 0; i < 20; i++) {
			lines.push({
				type: "user",
				message: { role: "user", content: `Message ${i}` },
			});
		}
		const path = await writeTempTranscript(lines);
		try {
			const result = await readTranscript(path, 5);
			expect(result).toHaveLength(5);
			expect(result[0]?.content).toBe("Message 15");
			expect(result[4]?.content).toBe("Message 19");
		} finally {
			await rm(join(path, ".."), { recursive: true, force: true });
		}
	});

	test("handles malformed JSON lines gracefully", async () => {
		const dir = await mkdtemp(join(tmpdir(), "tyr-transcript-test-"));
		const path = join(dir, "transcript.jsonl");
		const content = [
			"not json at all",
			JSON.stringify({
				type: "user",
				message: { role: "user", content: "Valid" },
			}),
			"{broken json",
		].join("\n");
		await writeFile(path, content, "utf-8");
		try {
			const result = await readTranscript(path, 10);
			expect(result).toEqual([{ role: "user", content: "Valid" }]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("skips user messages with non-string content", async () => {
		const path = await writeTempTranscript([
			{
				type: "user",
				message: {
					role: "user",
					content: [{ type: "text", text: "array content" }],
				},
			},
		]);
		try {
			const result = await readTranscript(path, 10);
			expect(result).toEqual([]);
		} finally {
			await rm(join(path, ".."), { recursive: true, force: true });
		}
	});
});

describe.concurrent("formatTranscriptForPrompt", () => {
	test("returns empty string for no messages", () => {
		expect(formatTranscriptForPrompt([])).toBe("");
	});

	test("formats messages with role labels", () => {
		const messages: TranscriptMessage[] = [
			{ role: "user", content: "What does this do?" },
			{ role: "assistant", content: "It runs tests." },
		];
		const result = formatTranscriptForPrompt(messages);
		expect(result).toBe(
			"[user]: What does this do?\n[assistant]: It runs tests.",
		);
	});

	test("truncates long messages", () => {
		const longContent = "a".repeat(600);
		const messages: TranscriptMessage[] = [
			{ role: "user", content: longContent },
		];
		const result = formatTranscriptForPrompt(messages);
		expect(result).toContain("...");
		// 500 chars + "[user]: " prefix + "..."
		expect(result.length).toBeLessThan(520);
	});

	test("respects custom maxCharsPerMessage", () => {
		const messages: TranscriptMessage[] = [
			{ role: "user", content: "abcdefghij" },
		];
		const result = formatTranscriptForPrompt(messages, 5);
		expect(result).toBe("[user]: abcde...");
	});

	test("does not truncate messages within limit", () => {
		const messages: TranscriptMessage[] = [{ role: "user", content: "short" }];
		const result = formatTranscriptForPrompt(messages);
		expect(result).toBe("[user]: short");
	});
});
