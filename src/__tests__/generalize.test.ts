import { describe, expect, test } from "bun:test";
import { buildGeneralizePrompt, parseGeneralizeResponse } from "../prompts.ts";

describe("buildGeneralizePrompt", () => {
	test("includes all commands with counts", () => {
		const prompt = buildGeneralizePrompt([
			{ command: "bun test", count: 10 },
			{ command: "bun lint", count: 8 },
		]);
		expect(prompt).toContain("`bun test` (approved 10 times)");
		expect(prompt).toContain("`bun lint` (approved 8 times)");
	});

	test("includes glob pattern instructions", () => {
		const prompt = buildGeneralizePrompt([{ command: "git status", count: 5 }]);
		expect(prompt).toContain("glob patterns");
		expect(prompt).toContain("`*` matches any sequence of characters");
	});

	test("instructs broad generalization", () => {
		const prompt = buildGeneralizePrompt([
			{ command: "npm run test", count: 5 },
		]);
		expect(prompt).toContain("Aggressively group");
		expect(prompt).toContain("Prefer broader patterns");
	});

	test("requests JSON array response format", () => {
		const prompt = buildGeneralizePrompt([{ command: "echo hello", count: 5 }]);
		expect(prompt).toContain('"pattern"');
		expect(prompt).toContain('"count"');
		expect(prompt).toContain('"commands"');
	});
});

describe("parseGeneralizeResponse", () => {
	test("parses valid JSON array", () => {
		const input = JSON.stringify([
			{
				pattern: "bun *",
				count: 18,
				commands: ["bun test", "bun lint"],
			},
			{
				pattern: "git status",
				count: 12,
				commands: ["git status"],
			},
		]);
		const result = parseGeneralizeResponse(input);
		expect(result).toEqual([
			{ pattern: "bun *", count: 18, commands: ["bun test", "bun lint"] },
			{ pattern: "git status", count: 12, commands: ["git status"] },
		]);
	});

	test("handles markdown code fences", () => {
		const input = `\`\`\`json
[{"pattern": "npm run *", "count": 20, "commands": ["npm run test", "npm run build"]}]
\`\`\``;
		const result = parseGeneralizeResponse(input);
		expect(result).toEqual([
			{
				pattern: "npm run *",
				count: 20,
				commands: ["npm run test", "npm run build"],
			},
		]);
	});

	test("handles bare code fences", () => {
		const input = `\`\`\`
[{"pattern": "git diff *", "count": 13, "commands": ["git diff src/a.ts"]}]
\`\`\``;
		const result = parseGeneralizeResponse(input);
		expect(result).toEqual([
			{
				pattern: "git diff *",
				count: 13,
				commands: ["git diff src/a.ts"],
			},
		]);
	});

	test("returns null for empty string", () => {
		expect(parseGeneralizeResponse("")).toBeNull();
		expect(parseGeneralizeResponse("   ")).toBeNull();
	});

	test("returns null for non-array JSON", () => {
		expect(
			parseGeneralizeResponse('{"pattern": "test", "count": 1}'),
		).toBeNull();
	});

	test("returns null for invalid JSON", () => {
		expect(parseGeneralizeResponse("not json at all")).toBeNull();
	});

	test("skips items with missing fields", () => {
		const input = JSON.stringify([
			{ pattern: "bun *", count: 10, commands: ["bun test"] },
			{ pattern: "bad", count: 5 }, // missing commands
			{ count: 3, commands: ["x"] }, // missing pattern
		]);
		const result = parseGeneralizeResponse(input);
		expect(result).toEqual([
			{ pattern: "bun *", count: 10, commands: ["bun test"] },
		]);
	});

	test("returns null when all items are invalid", () => {
		const input = JSON.stringify([
			{ pattern: 123, count: "not a number", commands: "not an array" },
		]);
		expect(parseGeneralizeResponse(input)).toBeNull();
	});

	test("handles whitespace around JSON", () => {
		const input = `  \n[{"pattern": "echo *", "count": 5, "commands": ["echo hello"]}]\n  `;
		const result = parseGeneralizeResponse(input);
		expect(result).toEqual([
			{ pattern: "echo *", count: 5, commands: ["echo hello"] },
		]);
	});
});
