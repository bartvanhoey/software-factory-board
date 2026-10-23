#!/usr/bin/env bash
# Placeholder entrypoint. The Node runner replaces this in the next step.
# Prints the toolchain versions so the image can be checked at a glance.
set -euo pipefail

echo "factory sandbox: user=$(id -un) uid=$(id -u)"
echo "node    $(node --version)"
echo "git     $(git --version | cut -d' ' -f3)"
echo "gh      $(gh --version | head -1 | cut -d' ' -f3)"
echo "claude  $(claude --version | head -1)"
echo "dotnet  $(dotnet --version)"

if [ "$#" -gt 0 ]; then exec "$@"; fi
