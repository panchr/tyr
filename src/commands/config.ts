import { defineCommand } from "citty";
import {
	getConfigPath,
	isValidKey,
	parseValue,
	readConfig,
	writeConfig,
} from "../config.ts";

const show = defineCommand({
	meta: {
		name: "show",
		description: "Display current configuration",
	},
	async run() {
		const config = await readConfig();
		console.log(JSON.stringify(config, null, 2));
	},
});

const set = defineCommand({
	meta: {
		name: "set",
		description:
			"Set a configuration value (e.g. tyr config set failOpen true)",
	},
	args: {
		key: { type: "positional", description: "Config key", required: true },
		value: { type: "positional", description: "Config value", required: true },
	},
	async run({ args }) {
		const key = args.key as string;
		const value = args.value as string;

		if (!isValidKey(key)) {
			console.error(`Unknown config key: ${key}`);
			process.exit(1);
			return;
		}

		const parsed = parseValue(key, value);
		if (parsed === null) {
			console.error(`Invalid value for ${key}: ${value}`);
			process.exit(1);
			return;
		}

		const config = await readConfig();
		(config as unknown as Record<string, unknown>)[key] = parsed;
		await writeConfig(config);
		console.log(`Set ${key} = ${String(parsed)}`);
	},
});

const path = defineCommand({
	meta: {
		name: "path",
		description: "Print the config file path",
	},
	run() {
		console.log(getConfigPath());
	},
});

export default defineCommand({
	meta: {
		name: "config",
		description: "View and manage tyr configuration",
	},
	subCommands: {
		show,
		set,
		path,
	},
});
