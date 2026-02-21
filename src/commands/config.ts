import { defineCommand } from "citty";
import { z } from "zod/v4";
import {
	getConfigPath,
	getEnvPath,
	isValidKey,
	parseValue,
	readConfig,
	readEnvFile,
	readRawConfig,
	writeConfig,
	writeEnvVar,
} from "../config.ts";
import { type TyrConfig, TyrConfigSchema } from "../types.ts";

const show = defineCommand({
	meta: {
		name: "show",
		description: "Display current configuration",
	},
	async run() {
		const config = await readConfig().catch((err) => {
			console.error(
				`Invalid config: ${err instanceof Error ? err.message : err}`,
			);
			return process.exit(1) as never;
		});
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

		const raw = await readRawConfig().catch((err) => {
			console.error(
				`Cannot read config: ${err instanceof Error ? err.message : err}`,
			);
			return process.exit(1) as never;
		});
		const parts = key.split(".");
		if (parts.length === 2) {
			const group = parts[0] as string;
			const field = parts[1] as string;
			if (!raw[group] || typeof raw[group] !== "object") raw[group] = {};
			(raw[group] as Record<string, unknown>)[field] = parsed;
		} else {
			raw[key] = parsed;
		}

		let config: TyrConfig;
		try {
			config = TyrConfigSchema.strict().parse(raw);
		} catch (err) {
			console.error(
				`Config would still be invalid after this change: ${err instanceof Error ? err.message : err}`,
			);
			process.exit(1);
			return;
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

const schema = defineCommand({
	meta: {
		name: "schema",
		description: "Print the config JSON Schema",
	},
	run() {
		const jsonSchema = z.toJSONSchema(TyrConfigSchema, {
			target: "draft-2020-12",
		});
		// z.toJSONSchema cannot represent .refine() constraints;
		// manually add the pattern for logRetention.
		const props = (jsonSchema as { properties?: Record<string, object> })
			.properties;
		if (props?.logRetention) {
			(props.logRetention as Record<string, unknown>).pattern =
				"^(0|\\d+[smhd])$";
		}
		console.log(JSON.stringify(jsonSchema, null, 2));
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
		schema,
		env,
	},
});
