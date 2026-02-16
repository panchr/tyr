#!/bin/bash
set -euo pipefail

# Only run in remote environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install mise
curl --fail --silent --show-error --proto '=https' https://mise.run -o /tmp/mise_install.sh
sh /tmp/mise_install.sh
rm -f /tmp/mise_install.sh
export PATH="$HOME/.local/bin:$PATH"

# Trust the project config and install tools
mise trust --quiet
mise install --yes

# Persist mise shims in PATH for subsequent commands
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "PATH=$HOME/.local/share/mise/shims:$HOME/.local/bin:$PATH" >>"$CLAUDE_ENV_FILE"
fi
