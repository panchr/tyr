import { defineCommand } from "citty";
import {
	getConfigPath,
	getEnvPath,
	isValidKey,
	parseValue,
	readConfig,
	readEnvFile,
	writeConfig,
	writeEnvVar,
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
		const parts = key.split(".");
		if (parts.length === 2) {
			const [group, field] = parts;
			(config as unknown as Record<string, Record<string, unknown>>)[
				group as string
			][field as string] = parsed;
		} else {
			(config as unknown as Record<string, unknown>)[key] = parsed;
		}
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

function maskValue(value: string): string {
	if (value.length <= 4) return "****";
	return `${value.slice(0, 4)}...`;
}

const envSet = defineCommand({
	meta: {
		name: "set",
		description:
			"Set an environment variable (e.g. tyr config env set KEY VALUE)",
	},
	args: {
		key: { type: "positional", description: "Variable name", required: true },
		value: {
			type: "positional",
			description: "Variable value",
			required: true,
		},
	},
	run({ args }) {
		const key = args.key as string;
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			console.error(`Invalid variable name: ${key}`);
			process.exit(1);
			return;
		}
		writeEnvVar(key, args.value as string);
		console.log(`Set ${key} in ${getEnvPath()}`);
	},
});

const envShow = defineCommand({
	meta: {
		name: "show",
		description: "Show environment variables (values masked)",
	},
	run() {
		const vars = readEnvFile();
		const entries = Object.entries(vars);
		if (entries.length === 0) {
			console.log("No environment variables set.");
			return;
		}
		for (const [key, value] of entries) {
			console.log(`${key}=${maskValue(value)}`);
		}
	},
});

const envPath = defineCommand({
	meta: {
		name: "path",
		description: "Print the env file path",
	},
	run() {
		console.log(getEnvPath());
	},
});

const env = defineCommand({
	meta: {
		name: "env",
		description: "Manage environment variables in tyr's .env file",
	},
	subCommands: {
		set: envSet,
		show: envShow,
		path: envPath,
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
		env,
	},
});
