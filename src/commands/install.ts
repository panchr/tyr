import { defineCommand } from "citty";
import { rejectUnknownArgs } from "../args.ts";
import type { JudgeMode } from "../install.ts";
import {
	getSettingsPath,
	isInstalled,
	mergeHook,
	readSettings,
	writeSettings,
} from "../install.ts";

const installArgs = {
	global: {
		type: "boolean" as const,
		description: "Write to ~/.claude/settings.json",
	},
	project: {
		type: "boolean" as const,
		description: "Write to .claude/settings.json (default)",
	},
	"dry-run": {
		type: "boolean" as const,
		description: "Print what would be written without modifying anything",
	},
	shadow: {
		type: "boolean" as const,
		description: "Install in shadow mode (run pipeline but always abstain)",
	},
	audit: {
		type: "boolean" as const,
		description:
			"Install in audit mode (log requests without running pipeline)",
	},
};

export default defineCommand({
	meta: {
		name: "install",
		description: "Register tyr as a Claude Code hook",
	},
	args: installArgs,
	async run({ args, rawArgs }) {
		rejectUnknownArgs(rawArgs, installArgs);

		if (args.shadow && args.audit) {
			console.error("--shadow and --audit are mutually exclusive");
			process.exit(1);
			return;
		}

		const scope = args.global ? "global" : "project";
		const dryRun = args["dry-run"] ?? false;
		const mode: JudgeMode = args.shadow
			? "shadow"
			: args.audit
				? "audit"
				: undefined;
		const settingsPath = getSettingsPath(scope);

		const settings = await readSettings(settingsPath);
		const alreadyInstalled = isInstalled(settings);
		const updated = mergeHook(settings, mode);

		if (dryRun) {
			console.log(`Would write to ${settingsPath}:\n`);
			console.log(JSON.stringify(updated, null, 2));
			return;
		}

		await writeSettings(settingsPath, updated);
		if (alreadyInstalled) {
			console.log(`Updated tyr hook in ${settingsPath}`);
		} else {
			console.log(`Installed tyr hook in ${settingsPath}`);
		}
	},
});
