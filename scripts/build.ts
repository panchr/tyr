import pkg from "../package.json";

const version = JSON.stringify(pkg.version);

const result = Bun.spawnSync([
	"bun",
	"build",
	"src/index.ts",
	"--compile",
	"--outfile",
	"/usr/local/bin/tyr",
	"--define",
	`TYR_VERSION=${version}`,
]);

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.exitCode);
