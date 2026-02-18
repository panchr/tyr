import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ClaudeAgent } from "../agents/claude.ts";
import { OpenRouterProvider } from "../providers/openrouter.ts";
import { DEFAULT_TYR_CONFIG } from "../types.ts";
import { makePermissionRequest, saveEnv } from "./helpers/index.ts";

const providerConfig = {
	model: "anthropic/claude-3-haiku",
	timeout: DEFAULT_TYR_CONFIG.llm.timeout,
	canDeny: DEFAULT_TYR_CONFIG.llm.canDeny,
	endpoint: DEFAULT_TYR_CONFIG.llm.endpoint,
};

/** Build an OpenRouter-shaped JSON response. */
function apiResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

describe.concurrent("OpenRouterProvider basic checks", () => {
	test("abstains for non-Bash tools", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const req = makePermissionRequest({
			tool_name: "Read",
			tool_input: { file_path: "/tmp/foo" },
		} as Parameters<typeof makePermissionRequest>[0]);

		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("abstain");
		agent.close();
	});

	test("abstains for empty command", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const req = makePermissionRequest({ command: "" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("abstain");
		agent.close();
	});

	test("abstains for missing command", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const req = makePermissionRequest();
		req.tool_input = {};
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("abstain");
		agent.close();
	});

	test("abstains when OPENROUTER_API_KEY is not set", async () => {
		const restoreEnv = saveEnv("OPENROUTER_API_KEY");
		try {
			delete process.env.OPENROUTER_API_KEY;
			const agent = new ClaudeAgent();
			const provider = new OpenRouterProvider(agent, providerConfig);

			const req = makePermissionRequest({ command: "echo hi" });
			const result = await provider.checkPermission(req);
			expect(result.decision).toBe("abstain");
			agent.close();
		} finally {
			restoreEnv();
		}
	});
});

// Not concurrent: mocks global fetch
describe("OpenRouterProvider fetch", () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = saveEnv("OPENROUTER_API_KEY");
		process.env.OPENROUTER_API_KEY = "test-key-123";
	});

	afterEach(() => {
		restoreEnv();
	});

	test("sends correct request to OpenRouter API", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify(apiResponse('{"decision": "allow", "reason": "safe"}')),
				{ status: 200 },
			),
		);

		const req = makePermissionRequest({ command: "npm test" });
		await provider.checkPermission(req);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${DEFAULT_TYR_CONFIG.llm.endpoint}/chat/completions`);
		expect(opts.method).toBe("POST");

		const headers = opts.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer test-key-123");
		expect(headers["Content-Type"]).toBe("application/json");

		const body = JSON.parse(opts.body as string) as Record<string, unknown>;
		expect(body.model).toBe("anthropic/claude-3-haiku");
		expect(body.temperature).toBe(0);
		expect(body.max_tokens).toBe(256);
		expect(body.messages).toBeArrayOfSize(1);

		fetchSpy.mockRestore();
		agent.close();
	});

	test("returns allow on valid allow response", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify(
					apiResponse(
						'{"decision": "allow", "reason": "safe development command"}',
					),
				),
				{ status: 200 },
			),
		);

		const req = makePermissionRequest({ command: "npm test" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("allow");
		expect(result.reason).toBe("safe development command");

		fetchSpy.mockRestore();
		agent.close();
	});

	test("converts deny to abstain when canDeny is false", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, {
			...providerConfig,
			canDeny: false,
		});

		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify(
					apiResponse('{"decision": "deny", "reason": "dangerous command"}'),
				),
				{ status: 200 },
			),
		);

		const req = makePermissionRequest({ command: "rm -rf /" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("abstain");
		expect(result.reason).toBe("dangerous command");

		fetchSpy.mockRestore();
		agent.close();
	});

	test("returns deny when canDeny is true", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, {
			...providerConfig,
			canDeny: true,
		});

		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify(
					apiResponse('{"decision": "deny", "reason": "dangerous command"}'),
				),
				{ status: 200 },
			),
		);

		const req = makePermissionRequest({ command: "rm -rf /" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("deny");
		expect(result.reason).toBe("dangerous command");

		fetchSpy.mockRestore();
		agent.close();
	});

	test("abstains on HTTP error response", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response("rate limited", { status: 429 }),
		);

		const req = makePermissionRequest({ command: "echo test" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("abstain");

		fetchSpy.mockRestore();
		agent.close();
	});

	test("abstains on invalid JSON in response content", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify(apiResponse("this is not json")), {
				status: 200,
			}),
		);

		const req = makePermissionRequest({ command: "echo test" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("abstain");

		fetchSpy.mockRestore();
		agent.close();
	});

	test("abstains on empty choices array", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ choices: [] }), { status: 200 }),
		);

		const req = makePermissionRequest({ command: "echo test" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("abstain");

		fetchSpy.mockRestore();
		agent.close();
	});

	test("abstains on network error", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValueOnce(
			new TypeError("fetch failed"),
		);

		const req = makePermissionRequest({ command: "echo test" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("abstain");

		fetchSpy.mockRestore();
		agent.close();
	});

	test("abstains on abort/timeout", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, {
			...providerConfig,
			timeout: 0.001, // 1ms timeout
		});

		const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValueOnce(
			new DOMException("The operation was aborted", "AbortError"),
		);

		const req = makePermissionRequest({ command: "echo test" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("abstain");

		fetchSpy.mockRestore();
		agent.close();
	});

	test("uses custom endpoint from config", async () => {
		const agent = new ClaudeAgent();
		const customEndpoint = "https://custom.api.example.com/v1";
		const provider = new OpenRouterProvider(agent, {
			...providerConfig,
			endpoint: customEndpoint,
		});

		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify(apiResponse('{"decision": "allow", "reason": "ok"}')),
				{ status: 200 },
			),
		);

		const req = makePermissionRequest({ command: "echo test" });
		await provider.checkPermission(req);

		const [url] = fetchSpy.mock.calls[0] as [string];
		expect(url).toBe(`${customEndpoint}/chat/completions`);

		fetchSpy.mockRestore();
		agent.close();
	});

	test("handles response with code fences", async () => {
		const agent = new ClaudeAgent();
		const provider = new OpenRouterProvider(agent, providerConfig);

		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify(
					apiResponse('```json\n{"decision": "allow", "reason": "safe"}\n```'),
				),
				{ status: 200 },
			),
		);

		const req = makePermissionRequest({ command: "npm run build" });
		const result = await provider.checkPermission(req);
		expect(result.decision).toBe("allow");
		expect(result.reason).toBe("safe");

		fetchSpy.mockRestore();
		agent.close();
	});
});
