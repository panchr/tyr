# tyr CLI Specification

## CLI Structure

```
tyr <subcommand> [options]
```

### `tyr check`
The core command — invoked as a Claude hook. Reads `PermissionRequest` JSON from stdin, outputs a decision to stdout.

```
tyr check [--verbose]
```

- `--verbose` — emit debug info to stderr (won't interfere with hook JSON on stdout)

Provider selection and timeout are managed via `tyr config`.

### `tyr install`
Registers tyr as a hook in Claude's settings.

```
tyr install [--global | --project] [--dry-run]
```

- `--global` — write to `~/.claude/settings.json` (default)
- `--project` — write to `.claude/settings.json`
- `--dry-run` — print what would be written without modifying anything

### `tyr config`
View/manage tyr's own configuration.

```
tyr config show                     # print resolved config
tyr config set <key> <value>        # e.g. tyr config set failOpen true
tyr config path                     # print config file location
```

### `tyr log`
View recent permission check history.

```
tyr log [--last <n>] [--json] [--follow]
```

- `--last` — show last N entries (default: 20)
- `--json` — raw JSON output
- `--follow` — tail the log

### `tyr daemon` *(Phase 3)*
Manage the caching daemon.

```
tyr daemon start [--port <port>]
tyr daemon stop
tyr daemon status
```

### `tyr stats` *(Phase 4)*
Show metrics on permission decisions.

```
tyr stats [--since <duration>] [--json]
```

Output: cache hits, LLM checks, denials, fall-throughs, estimated user-effort saved.

### `tyr suggest` *(Phase 4)*
Suggest permissions to add to Claude settings based on decision history.

```
tyr suggest [--apply] [--global | --project]
```

- Default: print suggestions
- `--apply` — write them directly into Claude's settings

## Decision Flow (`tyr check`)

```
stdin JSON
  → parse PermissionRequest
  → check explicit denies (from Claude config) → deny immediately if matched
  → run enabled providers in order:
      1. cache (Phase 3+)
      2. chained-commands (Phase 1)
      3. llm (Phase 2)
  → first definitive result wins
  → no result / error → exit with empty output (fall-through to Claude's dialog)
```

## Subcommand Roadmap

| Subcommand | Phase | Purpose |
|---|---|---|
| `check` | 0.5+ | Hook entry point |
| `install` | 0 | Register hook in Claude settings |
| `config` | 0 | Manage tyr config |
| `log` | 0.5+ | View permission check history |
| `daemon` | 3 | Manage caching daemon |
| `stats` | 4 | View decision metrics |
| `suggest` | 4 | Recommend new permissions |
