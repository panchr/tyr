import { defineCommand } from "citty";
import { rejectUnknownArgs } from "../args.ts";
import {
	getSettingsPath,
	readSettings,
	removeHook,
	writeSettings,
} from "../install.ts";

const uninstallArgs = {
	global: {
		type: "boolean" as const,
		description: "Remove from ~/.claude/settings.json (default)",
	},
	project: {
		type: "boolean" as const,
		description: "Remove from .claude/settings.json",
	},
	"dry-run": {
		type: "boolean" as const,
		description: "Print what would be written without modifying anything",
	},
};

export default defineCommand({
	meta: {
		name: "uninstall",
		description: "Remove the tyr hook from Claude Code settings",
	},
	args: uninstallArgs,
	async run({ args, rawArgs }) {
		rejectUnknownArgs(rawArgs, uninstallArgs);
		const scope = args.project ? "project" : "global";
		const dryRun = args["dry-run"] ?? false;
		const settingsPath = getSettingsPath(scope);

		const settings = await readSettings(settingsPath);
		const updated = removeHook(settings);

		if (!updated) {
			console.log(`tyr hook not found in ${settingsPath}`);
			return;
		}

		if (dryRun) {
			console.log(`Would write to ${settingsPath}:\n`);
			console.log(JSON.stringify(updated, null, 2));
			return;
		}

		await writeSettings(settingsPath, updated);
		console.log(`Removed tyr hook from ${settingsPath}`);
	},
});
