import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	DEFAULT_TYR_CONFIG,
	type TyrConfig,
	TyrConfigSchema,
} from "./types.ts";

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

/** Strip // and /* comments from a JSON string, preserving strings. */
export function stripJsonComments(text: string): string {
	let result = "";
	let i = 0;
	while (i < text.length) {
		// String literal — copy verbatim including escapes
		if (text[i] === '"') {
			let j = i + 1;
			while (j < text.length && text[j] !== '"') {
				if (text[j] === "\\") j++; // skip escaped char
				j++;
			}
			result += text.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		// Single-line comment
		if (text[i] === "/" && text[i + 1] === "/") {
			const nl = text.indexOf("\n", i);
			i = nl === -1 ? text.length : nl;
			continue;
		}
		// Block comment
		if (text[i] === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end === -1 ? text.length : end + 2;
			continue;
		}
		result += text[i];
		i++;
	}
	return result;
}

/** Read tyr's config, returning defaults for missing or invalid files.
 *  Supports JSONC (JSON with Comments). Unknown keys are stripped;
 *  invalid values fall back to defaults. */
export async function readConfig(): Promise<TyrConfig> {
	const path = getConfigPath();
	try {
		const text = await readFile(path, "utf-8");
		const raw = JSON.parse(stripJsonComments(text));
		return TyrConfigSchema.parse(raw);
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
