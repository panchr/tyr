import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PROVIDER_NAMES, type TyrConfig, TyrConfigSchema } from "./types.ts";

const CONFIG_DIR = join(homedir(), ".config", "tyr");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** Return the path to tyr's config file. */
export function getConfigPath(): string {
	return process.env.TYR_CONFIG_FILE ?? CONFIG_FILE;
}

/** Return the path to tyr's `.env` file (next to config.json). */
export function getEnvPath(): string {
	return join(dirname(getConfigPath()), ".env");
}

/** Parse `.env` file content into key-value pairs. */
function parseEnv(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		// Strip matching quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
}

/** Load `.env` from the tyr config directory into `process.env`.
 *  Existing env vars take precedence. No-ops if the file doesn't exist. */
export function loadEnvFile(): void {
	const vars = readEnvFile();
	for (const [key, value] of Object.entries(vars)) {
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

/** Read and return parsed key-value pairs from the `.env` file. */
export function readEnvFile(): Record<string, string> {
	const envPath = getEnvPath();
	let text: string;
	try {
		text = readFileSync(envPath, "utf-8");
	} catch {
		return {};
	}
	return parseEnv(text);
}

/** Upsert a key in the `.env` file. Creates the file if missing. */
export function writeEnvVar(key: string, value: string): void {
	const envPath = getEnvPath();
	let lines: string[] = [];
	if (existsSync(envPath)) {
		lines = readFileSync(envPath, "utf-8").split("\n");
	}

	const prefix = `${key}=`;
	let found = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;
		if (trimmed.startsWith(prefix) || trimmed.startsWith(`${key} =`)) {
			lines[i] = `${key}=${value}`;
			found = true;
			break;
		}
	}
	if (!found) {
		lines.push(`${key}=${value}`);
	}

	// Ensure trailing newline
	const content = lines.join("\n").replace(/\n*$/, "\n");
	const dir = dirname(envPath);
	mkdirSync(dir, { recursive: true });
	writeFileSync(envPath, content, "utf-8");
}

/** Map of all settable config key paths to their expected types. */
const VALID_KEY_TYPES: Record<
	string,
	"boolean" | "string" | "number" | "providers"
> = {
	providers: "providers",
	failOpen: "boolean",
	conversationContext: "boolean",
	verboseLog: "boolean",
	logRetention: "string",
	"claude.model": "string",
	"claude.timeout": "number",
	"claude.canDeny": "boolean",
	"openrouter.model": "string",
	"openrouter.endpoint": "string",
	"openrouter.timeout": "number",
	"openrouter.canDeny": "boolean",
};

/** Check if a string is a valid config key (supports dot notation for claude.*, openrouter.*). */
export function isValidKey(key: string): boolean {
	return key in VALID_KEY_TYPES;
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

/** Read the raw JSON from tyr's config file without schema validation.
 *  Returns an empty object when the file is missing. Supports JSONC. */
export async function readRawConfig(): Promise<Record<string, unknown>> {
	const path = getConfigPath();
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch (err: unknown) {
		if (
			err instanceof Error &&
			"code" in err &&
			(err as NodeJS.ErrnoException).code === "ENOENT"
		) {
			return {};
		}
		throw err;
	}
	return JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
}

/** Read tyr's config. Returns defaults when the file is missing.
 *  Supports JSONC (JSON with Comments). Rejects unrecognized keys. */
export async function readConfig(): Promise<TyrConfig> {
	const raw = await readRawConfig();
	return TyrConfigSchema.strict().parse(raw);
}

/** Write config to disk, creating parent directories as needed. */
export async function writeConfig(config: TyrConfig): Promise<void> {
	const path = getConfigPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

/** Parse a string value into the expected type for a config key path. */
export function parseValue(
	key: string,
	value: string,
): boolean | string | number | string[] | null {
	const expected = VALID_KEY_TYPES[key];
	if (!expected) return null;
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
	if (expected === "providers") {
		const valid = new Set<string>(PROVIDER_NAMES);
		const names = value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (names.length === 0) return null;
		for (const n of names) {
			if (!valid.has(n)) return null;
		}
		return names;
	}
	return null;
}
