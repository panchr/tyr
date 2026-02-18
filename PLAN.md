# tyr Plan

## Description
This is a CLI that performs more thorough, automated permission checks for coding agents. The goal is to reduce friction for users,
by allowing LLMs to perform permission checks on behalf of the user themselves *while still respecting the user permissions*. It will just support Claude at the beginning.

It will be invoked as a Claude hook on permission requests.

We'll build this as a TypeScript project using `bun`.

## Phases

### Phase 0
Set up the repo, with linting and typechecking.

Research a good interface for this CLI, and suggest what it would look like. I mean the subcommands and arguments, based on what you know about the next set of phases and what the goal of the tool is.
Research Claude's permission model and configuration.

Some to think of: the main functionality should be behind a subcommand, like `<cli-name> check ...`.

### Phase 0.5
Just log permission checks (to ensure the plugin is receiving them).

### Phase 1
Read the claude permissions (global + project) and get a permission set. Match permissions against this set, using the chained-commands provider.
No other providers should be supported yet.

### Phase 2
Just run claude -p "prompt…" with a pre-defined prompt, that is templated with the permission set read from Claude's config.

### Phase 3
SQLite-backed storage for decision logs, permission cache, and metrics.

- **Decision cache** — keyed by (tool_name, tool_input, cwd, config_hash). The config hash is a SHA256 fingerprint of Claude settings + tyr config, so cache entries are automatically invalidated when settings change.
- **Durable logging** — all decisions stored in SQLite with WAL mode for concurrent readers.
- **Metrics** — `tyr stats` aggregates decisions, cache hit rates, provider distribution from the SQLite database.
- **Suggestions** — `tyr suggest` queries frequently-allowed commands and recommends new allow rules for Claude settings.

### Future Work
* Support OpenRouter as a provider (for LLM checks)
* Support other agents, namely opencode

## Modules
* `src/providers/` - defines the providers for LLM-based permission checks. The first should be Claude invoked as a subprocess (e.g. just `claude -p`), and the other is a chained-commands provider.
   An interface should be defined for this, that each provider satisfies. Something like `checkPermission(permissionRequest: string): Promise<PermissionResult>`
* `src/config.ts` - config parsing
* `src/agents/` - defines agent-specific features. The first should just be Claude. For each agent, we need to support reading and parsing their configuration (across all precedence levels!) in order
  to understand what permissions they already define. The config should be watched so we know of any changes. Define an interface for this.

## Config
`providers` - ordered list of providers to run in the pipeline (e.g. `["chained-commands", "llm"]`)
`failOpen` - whether to allow commands when tyr encounters an error (default: `false`, i.e. fail-closed)

<!-- TODO: flesh out config as needed — likely additions: per-project overrides, provider priority/ordering, LLM check timeout, log level/destination, explicit allow/deny patterns -->

## Providers

### Chained Commands
Chained commands checks if two or more commands, both of which are allowed individually, are simply chained together.

For example, if `bun test` is allowed and `less` is allowed, then

```
bun test | less
```

should also be allowed, as should

```
bun test 2>&1 | less
```

In practice, Claude's permission checks often fail on these, where pipes or `&&` or `||` may cause the command
to ask for permission.

So, the command must be parsed and checked if each individual command is allowed; if so, the chained one is also allowed.

We'll need to use some library to do this parsing, and also add plenty of unit tests to ensure the parsing works correctly.

**Shell parser library:** Use [`sh-syntax`](https://www.npmjs.com/package/sh-syntax), a WebAssembly port of Go's `mvdan/sh` parser. It produces a full AST, handles POSIX shell + Bash syntax (pipes, `&&`/`||`, subshells, command substitution, quoted strings, redirections), is actively maintained, and is ~4x faster than the older GopherJS-based `mvdan-sh` package. Alternatives considered:
- `bash-parser` — full AST but unmaintained (last update 2015)
- `shell-quote` — actively maintained but only tokenizes (flat array, no hierarchy), insufficient for nested structures like subshells

### Claude

You can run something like this to get Claude itself to check if a command is allowed:

```
claude --model haiku -p --json-schema '{"type":"object","properties":{"allowed":{"type":"bool"}},"required":["allowed"]}' "Is running '<command>' in this repository allowed by Claude? Return a JSON object specifying yes or no, with the 'allowed' field set to the result"
```

Note that this is currently vulnerable to shell escape-based injection (command
injection), so we need to be careful with it. We'll need to add many tests for
this to ensure shell escapes are not possible.

## Caching
Permission decisions are cached in a SQLite table keyed by (tool_name, tool_input, cwd, config_hash). The config hash is a SHA256 fingerprint of the agent's settings and tyr's own config, so cached entries are automatically invalidated whenever the user changes their Claude settings or tyr configuration.

Cache reads and writes happen synchronously via Bun's built-in SQLite driver (no separate daemon or IPC needed). The database uses WAL mode for safe concurrent access from multiple tyr invocations.

## Security Model

**Fail-closed by default.** If tyr crashes, times out, or encounters an unexpected error, the permission request is *not* approved — it falls through to Claude's normal permission dialog. The `failOpen` config field can override this, but the default is safe.

**Explicit denies are respected.** Before any provider runs, tyr checks the command against explicitly denied patterns in Claude's configuration (the `deny` rules in settings). If a command matches a deny rule, it is rejected immediately — no provider can override an explicit deny.

**LLM hallucination guard.** The LLM provider (Phase 2) can only *approve* commands that are not explicitly denied. It cannot override deny rules or the fail-closed default. This bounds the damage from a hallucinated "allowed: true" response.

## Hook Interface

tyr is invoked as a Claude Code hook on `PermissionRequest` events.

**Input (stdin):** Claude passes a JSON object:
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/working/directory",
  "permission_mode": "default",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "bun test | less",
    "description": "Run tests and page output"
  }
}
```

**Output (stdout + exit code):**
- Exit `0` with JSON to allow or deny:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```
- Exit `0` with empty/no JSON to fall through to Claude's normal permission dialog (i.e. no opinion).
- Exit `2` to report a blocking error (stderr is shown to Claude).

**Configuration:** Add to `.claude/settings.json` (or global `~/.claude/settings.json`):
```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "tyr judge"
          }
        ]
      }
    ]
  }
}
```

## Development Loop

Aim for TDD. Once an interface is decided for an implementation:

1. Write unit tests, ensure they fail
2. Write functionality
3. Ensure all tests succeed
4. Write E2E tests
5. Revisit tests, see if any code could be tested further. If so, go ahead and add those new tests.
6. Ensure linting passes.

## Project Naming
The project is called `tyr`, after the Germanic God of Law.
