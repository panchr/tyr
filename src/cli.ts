#!/usr/bin/env bun

const USAGE = `
tyr - Intelligent permission management for Claude Code hooks

Usage:
  tyr <command> [options]

Commands:
  check       Evaluate a permission request (hook entry point)
  install     Register tyr as a Claude Code hook
  config      View and manage tyr configuration
  log         View permission check history

Options:
  --help      Show this help message
  --version   Show version

Run 'tyr <command> --help' for more information on a command.
`.trim();

function main(): void {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		console.log(USAGE);
		process.exit(0);
	}

	if (args.includes("--version") || args.includes("-v")) {
		console.log("tyr 0.0.0");
		process.exit(0);
	}

	const command = args[0];
	console.error(`Unknown command: ${command}`);
	console.log(USAGE);
	process.exit(1);
}

main();
