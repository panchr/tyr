# tyr CLI Specification

## CLI Structure

```
tyr <subcommand> [options]
```

### `tyr judge`
The core command — invoked as a Claude hook. Reads `PermissionRequest` JSON from stdin, outputs a decision to stdout.

```
tyr judge [--verbose] [--shadow] [--audit]
```

- `--verbose` — emit debug info to stderr (won't interfere with hook JSON on stdout)
- `--shadow` — run the full pipeline but always abstain; the real decision is only logged
- `--audit` — skip the pipeline entirely; just log the request and abstain

Provider selection and timeout are managed via `tyr config`.

### `tyr install`
Registers tyr as a hook in Claude's settings.

```
tyr install [--global | --project] [--dry-run] [--shadow | --audit]
```

- `--global` — write to `~/.claude/settings.json` (default)
- `--project` — write to `.claude/settings.json`
- `--dry-run` — print what would be written without modifying anything
- `--shadow` / `--audit` — install in shadow or audit mode

### `tyr config`
View/manage tyr's own configuration.

```
tyr config show                     # print resolved config
tyr config set <key> <value>        # e.g. tyr config set failOpen true
tyr config path                     # print config file location
```

### `tyr log`
View recent permission check history from the SQLite database.

```
tyr log [--last <n>] [--json] [--since <time>] [--until <time>] [--decision <d>] [--provider <p>] [--cwd <path>]
```

- `--last` — show last N entries (default: 20)
- `--json` — raw JSON output
- `--since` / `--until` — filter by time range
- `--decision` — filter by decision (allow/deny/abstain)
- `--provider` — filter by provider
- `--cwd` — filter by working directory

### `tyr stats`
Show metrics on permission decisions.

```
tyr stats [--since <duration>] [--json]
```

Output: total checks, decisions breakdown, cache hit rate, provider distribution, auto-approvals.

### `tyr suggest`
Suggest permissions to add to Claude settings based on decision history.

```
tyr suggest [--apply] [--global | --project] [--min-count <n>] [--json]
```

- Default: print suggestions
- `--apply` — write them directly into Claude's settings
- `--min-count` — minimum number of occurrences to suggest (default: 3)

## Decision Flow (`tyr judge`)

```
stdin JSON
  → parse PermissionRequest
  → check explicit denies (from Claude config) → deny immediately if matched
  → run enabled providers in order:
      1. cache (SQLite lookup — same command + config hash → cached result)
      2. chained-commands
      3. llm
  → first definitive result wins
  → cache definitive results for future lookups
  → no result / error → exit with empty output (fall-through to Claude's dialog)
```

## Subcommand Roadmap

| Subcommand | Phase | Purpose |
|---|---|---|
| `judge` | 0.5+ | Hook entry point |
| `install` | 0 | Register hook in Claude settings |
| `config` | 0 | Manage tyr config |
| `log` | 0.5+ | View permission check history |
| `stats` | 3 | View decision metrics |
| `suggest` | 3 | Recommend new permissions |
