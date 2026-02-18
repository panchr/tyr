import { defineCommand } from "citty";
import { ClaudeAgent } from "../agents/claude.ts";
import { rejectUnknownArgs } from "../args.ts";
import { readConfig } from "../config.ts";
import { closeDb } from "../db.ts";
import { parsePermissionRequest, readStdin } from "../judge.ts";
import {
	appendLogEntry,
	extractToolInput,
	type LlmLogEntry,
	type LogEntry,
	migrateJsonlToSqlite,
} from "../log.ts";
import { runPipeline } from "../pipeline.ts";
import { buildPrompt } from "../prompts.ts";
import { ChainedCommandsProvider } from "../providers/chained-commands.ts";
import { LlmProvider } from "../providers/llm.ts";
import { OpenRouterProvider } from "../providers/openrouter.ts";
import type { HookResponse, Provider } from "../types.ts";

const judgeArgs = {
	verbose: {
		type: "boolean" as const,
		description: "Emit debug info to stderr",
	},
	shadow: {
		type: "boolean" as const,
		description:
			"Run the full pipeline but always abstain; the real decision is only logged",
	},
	audit: {
		type: "boolean" as const,
		description: "Skip the pipeline entirely; just log the request and abstain",
	},
	// Config overrides (kebab-case flags that override config file values)
	"allow-chained-commands": {
		type: "boolean" as const,
		description: "Override allowChainedCommands config",
	},
	"allow-prompt-checks": {
		type: "boolean" as const,
		description: "Override allowPromptChecks config",
	},
	"cache-checks": {
		type: "boolean" as const,
		description: "Override cacheChecks config",
	},
	"fail-open": {
		type: "boolean" as const,
		description: "Override failOpen config",
	},
	"llm-provider": {
		type: "string" as const,
		description: "Override llmProvider config",
	},
	"llm-model": {
		type: "string" as const,
		description: "Override llmModel config",
	},
	"llm-endpoint": {
		type: "string" as const,
		description: "Override llmEndpoint config",
	},
	"llm-timeout": {
		type: "string" as const,
		description: "Override llmTimeout config (seconds)",
	},
	"llm-can-deny": {
		type: "boolean" as const,
		description: "Override llmCanDeny config",
	},
	"verbose-log": {
		type: "boolean" as const,
		description: "Include LLM prompt and parameters in log entries",
	},
};

export default defineCommand({
	meta: {
		name: "judge",
		description: "Evaluate a permission request (hook entry point)",
	},
	args: judgeArgs,
	async run({ args, rawArgs }) {
		rejectUnknownArgs(rawArgs, judgeArgs);
		const verbose = args.verbose ?? false;
		const shadow = args.shadow ?? false;
		const audit = args.audit ?? false;

		if (shadow && audit) {
			console.error("[tyr] --shadow and --audit are mutually exclusive");
			process.exit(1);
			return;
		}

		const startTime = performance.now();

		let raw: string;
		try {
			raw = await readStdin();
		} catch (err) {
			if (verbose) console.error("[tyr] failed to read stdin:", err);
			process.exit(2);
			return;
		}

		if (verbose) console.error("[tyr] stdin:", raw);

		let data: unknown;
		try {
			data = JSON.parse(raw);
		} catch {
			if (verbose) console.error("[tyr] malformed JSON input");
			process.exit(2);
			return;
		}

		const req = parsePermissionRequest(data);
		if (!req) {
			if (verbose) console.error("[tyr] invalid PermissionRequest shape");
			process.exit(2);
			return;
		}

		if (verbose) {
			console.error(
				`[tyr] tool=${req.tool_name} input=${JSON.stringify(req.tool_input)}`,
			);
		}

		// Migrate legacy JSONL logs on first run
		try {
			migrateJsonlToSqlite(verbose);
		} catch (err) {
			if (verbose) console.error("[tyr] JSONL migration failed:", err);
		}

		// Audit mode: log the request and exit without running the pipeline
		if (audit) {
			const duration = performance.now() - startTime;
			const toolInput = extractToolInput(req.tool_name, req.tool_input);
			const entry: LogEntry = {
				timestamp: Date.now(),
				cwd: req.cwd,
				tool_name: req.tool_name,
				tool_input: toolInput,
				input: JSON.stringify(req.tool_input),
				decision: "abstain",
				provider: null,
				duration_ms: Math.round(duration),
				session_id: req.session_id,
				mode: "audit",
			};
			try {
				appendLogEntry(entry);
			} catch (err) {
				if (verbose) console.error("[tyr] failed to write log:", err);
			}
			if (verbose) {
				console.error("[tyr] audit mode: logged request, skipping pipeline");
			}
			closeDb();
			process.exit(0);
			return;
		}

		// Build provider pipeline based on config, applying CLI overrides
		const config = await readConfig();
		if (args["allow-chained-commands"] !== undefined)
			config.allowChainedCommands = args["allow-chained-commands"];
		if (args["allow-prompt-checks"] !== undefined)
			config.allowPromptChecks = args["allow-prompt-checks"];
		if (args["cache-checks"] !== undefined)
			config.cacheChecks = args["cache-checks"];
		if (args["fail-open"] !== undefined) config.failOpen = args["fail-open"];
		if (args["llm-provider"] !== undefined) {
			const p = args["llm-provider"];
			if (p !== "claude" && p !== "openrouter") {
				console.error(`[tyr] invalid --llm-provider value: ${p}`);
				process.exit(1);
				return;
			}
			config.llmProvider = p;
		}
		if (args["llm-model"] !== undefined) config.llmModel = args["llm-model"];
		if (args["llm-endpoint"] !== undefined)
			config.llmEndpoint = args["llm-endpoint"];
		if (args["llm-timeout"] !== undefined) {
			const t = Number(args["llm-timeout"]);
			if (!Number.isFinite(t) || t <= 0) {
				console.error(
					`[tyr] invalid --llm-timeout value: ${args["llm-timeout"]}`,
				);
				process.exit(1);
				return;
			}
			config.llmTimeout = t;
		}
		if (args["llm-can-deny"] !== undefined)
			config.llmCanDeny = args["llm-can-deny"];
		if (args["verbose-log"] !== undefined)
			config.verboseLog = args["verbose-log"];

		const agent = new ClaudeAgent();
		try {
			await agent.init(req.cwd);
		} catch (err) {
			if (verbose) console.error("[tyr] failed to init agent config:", err);
		}

		const providers: Provider[] = [];
		if (config.allowChainedCommands) {
			providers.push(new ChainedCommandsProvider(agent));
		}
		if (config.allowPromptChecks) {
			if (config.llmProvider === "openrouter") {
				providers.push(new OpenRouterProvider(agent, config, verbose));
			} else {
				providers.push(new LlmProvider(agent, config, verbose));
			}
		}

		// Run pipeline
		let result = await runPipeline(providers, req);

		if (verbose) {
			console.error(
				`[tyr] decision=${result.decision} provider=${result.provider ?? "none"}`,
			);
		}

		// If all providers abstained and failOpen is enabled, allow the request
		if (result.decision === "abstain" && config.failOpen) {
			result = {
				decision: "allow",
				provider: "fail-open",
			};
			if (verbose) {
				console.error("[tyr] failOpen=true, converting abstain to allow");
			}
		}

		// Log the decision
		const duration = performance.now() - startTime;
		const toolInput = extractToolInput(req.tool_name, req.tool_input);
		const entry: LogEntry = {
			timestamp: Date.now(),
			cwd: req.cwd,
			tool_name: req.tool_name,
			tool_input: toolInput,
			input: JSON.stringify(req.tool_input),
			decision: result.decision,
			provider: result.provider ?? null,
			reason: result.reason,
			duration_ms: Math.round(duration),
			session_id: req.session_id,
			mode: shadow ? "shadow" : undefined,
		};

		const llm: LlmLogEntry | undefined = config.verboseLog
			? {
					prompt: buildPrompt(req, agent, config.llmCanDeny),
					model: config.llmModel,
				}
			: undefined;

		try {
			appendLogEntry(entry, llm);
		} catch (err) {
			if (verbose) console.error("[tyr] failed to write log:", err);
		}

		// In shadow mode, always abstain to Claude Code regardless of the real decision
		if (shadow) {
			if (verbose) {
				console.error(
					`[tyr] shadow mode: suppressing decision=${result.decision}`,
				);
			}
			agent.close();
			closeDb();
			process.exit(0);
			return;
		}

		// Emit response to stdout if we have a definitive decision
		if (result.decision === "allow" || result.decision === "deny") {
			const decision: HookResponse["hookSpecificOutput"]["decision"] = {
				behavior: result.decision,
			};
			if (result.decision === "deny" && result.reason) {
				decision.message = result.reason;
			}
			const response: HookResponse = {
				hookSpecificOutput: {
					hookEventName: "PermissionRequest",
					decision,
				},
			};
			console.log(JSON.stringify(response));
		}

		agent.close();
		closeDb();
		process.exit(0);
	},
});
