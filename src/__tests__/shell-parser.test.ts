import { describe, expect, test } from "bun:test";
import { parseCommands } from "../providers/shell-parser.ts";

describe.concurrent("parseCommands", () => {
	test("simple command", () => {
		const result = parseCommands("echo hello");
		expect(result).toEqual([
			{ command: "echo hello", args: ["echo", "hello"] },
		]);
	});

	test("command with flags", () => {
		const result = parseCommands("ls -la /tmp");
		expect(result).toEqual([
			{ command: "ls -la /tmp", args: ["ls", "-la", "/tmp"] },
		]);
	});

	test("pipes", () => {
		const result = parseCommands("cat foo | grep bar | wc -l");
		expect(result).toHaveLength(3);
		expect(result[0]?.command).toBe("cat foo");
		expect(result[1]?.command).toBe("grep bar");
		expect(result[2]?.command).toBe("wc -l");
	});

	test("&& operator", () => {
		const result = parseCommands("git add . && git commit -m test");
		expect(result).toHaveLength(2);
		expect(result[0]?.command).toBe("git add .");
		expect(result[1]?.command).toBe("git commit -m test");
	});

	test("|| operator", () => {
		const result = parseCommands("cmd1 || cmd2");
		expect(result).toHaveLength(2);
		expect(result[0]?.command).toBe("cmd1");
		expect(result[1]?.command).toBe("cmd2");
	});

	test("semicolons", () => {
		const result = parseCommands("cd /tmp; ls; pwd");
		expect(result).toHaveLength(3);
		expect(result[0]?.command).toBe("cd /tmp");
		expect(result[1]?.command).toBe("ls");
		expect(result[2]?.command).toBe("pwd");
	});

	test("mixed operators", () => {
		const result = parseCommands("cmd1 && cmd2 || cmd3; cmd4");
		expect(result).toHaveLength(4);
		expect(result[0]?.command).toBe("cmd1");
		expect(result[1]?.command).toBe("cmd2");
		expect(result[2]?.command).toBe("cmd3");
		expect(result[3]?.command).toBe("cmd4");
	});

	test("subshell", () => {
		const result = parseCommands("(cd /tmp && ls)");
		expect(result).toHaveLength(2);
		expect(result[0]?.command).toBe("cd /tmp");
		expect(result[1]?.command).toBe("ls");
	});

	test("command substitution", () => {
		const result = parseCommands("echo $(whoami)");
		// Walk finds both the outer echo and the inner whoami
		expect(result).toHaveLength(2);
		expect(result.map((c) => c.command)).toContain("whoami");
	});

	test("single-quoted strings", () => {
		const result = parseCommands("git commit -m 'hello world'");
		expect(result).toHaveLength(1);
		expect(result[0]?.args).toEqual(["git", "commit", "-m", "hello world"]);
	});

	test("double-quoted strings", () => {
		const result = parseCommands('echo "hello world"');
		expect(result).toHaveLength(1);
		expect(result[0]?.args).toEqual(["echo", "hello world"]);
	});

	test("redirections don't affect command extraction", () => {
		const result = parseCommands("echo hello > out.txt 2>&1");
		expect(result).toHaveLength(1);
		expect(result[0]?.command).toBe("echo hello");
	});

	test("nested subshell", () => {
		const result = parseCommands("(cd /tmp && (echo a; echo b))");
		expect(result).toHaveLength(3);
		expect(result[0]?.command).toBe("cd /tmp");
		expect(result[1]?.command).toBe("echo a");
		expect(result[2]?.command).toBe("echo b");
	});

	test("pipe into subshell", () => {
		const result = parseCommands("echo input | (cat && wc -l)");
		expect(result).toHaveLength(3);
		expect(result[0]?.command).toBe("echo input");
		expect(result[1]?.command).toBe("cat");
		expect(result[2]?.command).toBe("wc -l");
	});

	test("empty input", () => {
		expect(parseCommands("")).toEqual([]);
	});

	test("invalid syntax returns empty", () => {
		expect(parseCommands("if then else")).toEqual([]);
	});

	test("complex real-world command", () => {
		const result = parseCommands(
			"npm run build && npm test -- --coverage | tee output.log",
		);
		expect(result).toHaveLength(3);
		expect(result[0]?.command).toBe("npm run build");
		expect(result[1]?.command).toBe("npm test -- --coverage");
		expect(result[2]?.command).toBe("tee output.log");
	});
});
