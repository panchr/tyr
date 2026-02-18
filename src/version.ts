import pkg from "../package.json";

/**
 * For compiled binaries, TYR_VERSION is injected via --define at build time.
 * When running from source, reads from package.json.
 */
declare const TYR_VERSION: string | undefined;
export const VERSION: string =
	typeof TYR_VERSION === "string" ? TYR_VERSION : pkg.version;
