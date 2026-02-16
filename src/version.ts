/**
 * For compiled binaries, TYR_VERSION is injected via --define at build time.
 * When running from source, it falls back to the dev marker.
 */
declare const TYR_VERSION: string | undefined;
export const VERSION: string =
	typeof TYR_VERSION === "string" ? TYR_VERSION : "0.1.0-dev";
