import { defineCommand } from "citty";
import { ClaudeAgent } from "../agents/claude.ts";
import { rejectUnknownArgs } from "../args.ts";
import { computeConfigHash } from "../cache.ts";
import { loadEnvFile, parseValue, readConfig } from "../config.ts";
import { closeDb } from "../db.ts";
import { parsePermissionRequest, readStdin } from "../judge.ts";
import {
	appendLogEntry,
	extractToolInput,
	type LlmLogEntry,
	type LogEntry,
	truncateOldLogs,
} from "../log.ts";
import { runPipeline } from "../pipeline.ts";
import { buildPrompt } from "../prompts.ts";
import { CacheProvider } from "../providers/cache.ts";
import { ChainedCommandsProvider } from "../providers/chained-commands.ts";
import { ClaudeProvider } from "../providers/claude.ts";
import { OpenRouterProvider } from "../providers/openrouter.ts";
import type { HookResponse, Provider, TyrConfig } from "../types.ts";
import { resolveProviders } from "../types.ts";

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
	providers: {
		type: "string" as const,
		description:
			"Override providers list (comma-separated: cache,chained-commands,claude,openrouter)",
	},
	"fail-open": {
		type: "boolean" as const,
		description: "Override failOpen config",
	},
	"claude-model": {
		type: "string" as const,
		description: "Override claude.model config",
	},
	"claude-timeout": {
		type: "string" as const,
		description: "Override claude.timeout config (seconds)",
	},
	"claude-can-deny": {
		type: "boolean" as const,
		description: "Override claude.canDeny config",
	},
	"openrouter-model": {
		type: "string" as const,
		description: "Override openrouter.model config",
	},
	"openrouter-endpoint": {
		type: "string" as const,
		description: "Override openrouter.endpoint config",
	},
	"openrouter-timeout": {
		type: "string" as const,
		description: "Override openrouter.timeout config (seconds)",
	},
	"openrouter-can-deny": {
		type: "boolean" as const,
		description: "Override openrouter.canDeny config",
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

		// Validate config early so broken config is caught before stdin parsing
		let config: TyrConfig;
		try {
			config = await readConfig();
		} catch (err) {
			console.error(
				`[tyr] invalid config: ${err instanceof Error ? err.message : err}`,
			);
			process.exit(1);
			return;
		}

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
			try {
				truncateOldLogs(config.logRetention);
			} catch {
				// best-effort
			}
			if (verbose) {
				console.error("[tyr] audit mode: logged request, skipping pipeline");
			}
			closeDb();
			process.exit(0);
			return;
		}

		// Load env vars from tyr config directory (e.g. API keys)
		loadEnvFile();
		if (args.providers !== undefined) {
			const parsed = parseValue("providers", args.providers);
			if (!parsed) {
				console.error(`[tyr] invalid --providers value: ${args.providers}`);
				process.exit(1);
				return;
			}
			config.providers = parsed as TyrConfig["providers"];
		}
		if (args["fail-open"] !== undefined) config.failOpen = args["fail-open"];
		if (args["claude-model"] !== undefined)
			config.claude.model = args["claude-model"];
		if (args["claude-timeout"] !== undefined) {
			const t = Number(args["claude-timeout"]);
			if (!Number.isFinite(t) || t <= 0) {
				console.error(
					`[tyr] invalid --claude-timeout value: ${args["claude-timeout"]}`,
				);
				process.exit(1);
				return;
			}
			config.claude.timeout = t;
		}
		if (args["claude-can-deny"] !== undefined)
			config.claude.canDeny = args["claude-can-deny"];
		if (args["openrouter-model"] !== undefined)
			config.openrouter.model = args["openrouter-model"];
		if (args["openrouter-endpoint"] !== undefined)
			config.openrouter.endpoint = args["openrouter-endpoint"];
		if (args["openrouter-timeout"] !== undefined) {
			const t = Number(args["openrouter-timeout"]);
			if (!Number.isFinite(t) || t <= 0) {
				console.error(
					`[tyr] invalid --openrouter-timeout value: ${args["openrouter-timeout"]}`,
				);
				process.exit(1);
				return;
			}
			config.openrouter.timeout = t;
		}
		if (args["openrouter-can-deny"] !== undefined)
			config.openrouter.canDeny = args["openrouter-can-deny"];
		if (args["verbose-log"] !== undefined)
			config.verboseLog = args["verbose-log"];

		const agent = new ClaudeAgent();
		try {
			await agent.init(req.cwd);
		} catch (err) {
			if (verbose) console.error("[tyr] failed to init agent config:", err);
		}

		// Build provider pipeline from config
		const providers: Provider[] = [];
		let cacheProvider: CacheProvider | null = null;

		for (const name of resolveProviders(config)) {
			switch (name) {
				case "cache": {
					const configHash = computeConfigHash(agent, config);
					cacheProvider = new CacheProvider(configHash);
					providers.push(cacheProvider);
					break;
				}
				case "chained-commands":
					providers.push(new ChainedCommandsProvider(agent, verbose));
					break;
				case "claude":
					providers.push(new ClaudeProvider(agent, config.claude, verbose));
					break;
				case "openrouter":
					providers.push(
						new OpenRouterProvider(agent, config.openrouter, verbose),
					);
					break;
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

		// Write definitive results to cache (skip if result came from cache itself)
		if (
			cacheProvider &&
			result.provider !== "cache" &&
			(result.decision === "allow" || result.decision === "deny")
		) {
			try {
				cacheProvider.cacheResult(
					req,
					result.decision,
					result.provider ?? "unknown",
					result.reason,
				);
			} catch (err) {
				if (verbose) console.error("[tyr] failed to write cache:", err);
			}
		}

		// Log the decision
		const isCacheHit = result.provider === "cache";
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
			cached: isCacheHit ? 1 : 0,
			mode: shadow ? "shadow" : undefined,
		};

		let llm: LlmLogEntry | undefined;
		if (config.verboseLog) {
			if (result.provider === "claude") {
				llm = {
					prompt: buildPrompt(req, agent, config.claude.canDeny),
					model: config.claude.model,
				};
			} else if (result.provider === "openrouter") {
				llm = {
					prompt: buildPrompt(req, agent, config.openrouter.canDeny),
					model: config.openrouter.model,
				};
			} else {
				// Decision came from a non-LLM provider; log the first LLM in the pipeline
				for (const name of resolveProviders(config)) {
					if (name === "claude") {
						llm = {
							prompt: buildPrompt(req, agent, config.claude.canDeny),
							model: config.claude.model,
						};
						break;
					}
					if (name === "openrouter") {
						llm = {
							prompt: buildPrompt(req, agent, config.openrouter.canDeny),
							model: config.openrouter.model,
						};
						break;
					}
				}
			}
		}

		try {
			appendLogEntry(entry, llm);
		} catch (err) {
			if (verbose) console.error("[tyr] failed to write log:", err);
		}

		// Prune old log entries based on retention setting
		try {
			truncateOldLogs(config.logRetention);
		} catch (err) {
			if (verbose) console.error("[tyr] failed to truncate logs:", err);
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
