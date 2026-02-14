import { defineCommand } from "citty";
import { parsePermissionRequest, readStdin } from "../check.ts";
import { appendLogEntry, type LogEntry } from "../log.ts";

export default defineCommand({
	meta: {
		name: "check",
		description: "Evaluate a permission request (hook entry point)",
	},
	args: {
		verbose: {
			type: "boolean",
			description: "Emit debug info to stderr",
		},
	},
	async run({ args }) {
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

		// Fall-through: no opinion yet (providers will be wired in later)
		const duration = performance.now() - startTime;
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			tool_name: req.tool_name,
			tool_input: req.tool_input,
			decision: "abstain",
			provider: null,
			duration_ms: Math.round(duration),
			session_id: req.session_id,
		};

		try {
			await appendLogEntry(entry);
		} catch (err) {
			if (verbose) console.error("[tyr] failed to write log:", err);
		}

		process.exit(0);
	},
});
