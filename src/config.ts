import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_TYR_CONFIG, type TyrConfig } from "./types.ts";

const CONFIG_DIR = join(homedir(), ".config", "tyr");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** Return the path to tyr's config file. */
export function getConfigPath(): string {
	return process.env.TYR_CONFIG_FILE ?? CONFIG_FILE;
}

const VALID_KEYS = new Set<keyof TyrConfig>(
	Object.keys(DEFAULT_TYR_CONFIG) as (keyof TyrConfig)[],
);

/** Check if a string is a valid TyrConfig key. */
export function isValidKey(key: string): key is keyof TyrConfig {
	return VALID_KEYS.has(key as keyof TyrConfig);
}

/** Read tyr's config, returning defaults for missing or invalid files. */
export async function readConfig(): Promise<TyrConfig> {
	const path = getConfigPath();
	try {
		const text = await readFile(path, "utf-8");
		const parsed = JSON.parse(text) as Partial<TyrConfig>;
		return { ...DEFAULT_TYR_CONFIG, ...parsed };
	} catch {
		return { ...DEFAULT_TYR_CONFIG };
	}
}

/** Write config to disk, creating parent directories as needed. */
export async function writeConfig(config: TyrConfig): Promise<void> {
	const path = getConfigPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

/** Parse a string value into the expected type for a config key. */
export function parseValue(
	key: keyof TyrConfig,
	value: string,
): TyrConfig[keyof TyrConfig] | null {
	const expected = typeof DEFAULT_TYR_CONFIG[key];
	if (expected === "boolean") {
		if (value === "true") return true;
		if (value === "false") return false;
		return null;
	}
	if (expected === "string") {
		return value;
	}
	if (expected === "number") {
		if (value.trim() === "") return null;
		const num = Number(value);
		if (Number.isFinite(num)) return num;
		return null;
	}
	return null;
}
