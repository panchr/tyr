import { defineCommand } from "citty";
import { ClaudeAgent } from "../agents/claude.ts";
import { rejectUnknownArgs } from "../args.ts";
import { readConfig } from "../config.ts";
import { parsePermissionRequest, readStdin } from "../judge.ts";
import { appendLogEntry, type LogEntry } from "../log.ts";
import { runPipeline } from "../pipeline.ts";
import { ChainedCommandsProvider } from "../providers/chained-commands.ts";
import { LlmProvider } from "../providers/llm.ts";
import type { HookResponse, Provider } from "../types.ts";

const judgeArgs = {
	verbose: {
		type: "boolean" as const,
		description: "Emit debug info to stderr",
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

		// Build provider pipeline based on config
		const config = await readConfig();
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
			providers.push(new LlmProvider(agent, undefined, verbose));
		}

		// Run pipeline
		const result = await runPipeline(providers, req);

		if (verbose) {
			console.error(
				`[tyr] decision=${result.decision} provider=${result.provider ?? "none"}`,
			);
		}

		// Log the decision
		const duration = performance.now() - startTime;
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			cwd: req.cwd,
			tool_name: req.tool_name,
			tool_input: req.tool_input,
			decision: result.decision,
			provider: result.provider,
			duration_ms: Math.round(duration),
			session_id: req.session_id,
		};

		try {
			await appendLogEntry(entry);
		} catch (err) {
			if (verbose) console.error("[tyr] failed to write log:", err);
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
		process.exit(0);
	},
});
