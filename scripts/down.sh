#!/bin/sh
# Stops the stack started by scripts/up.sh (same compose project).
# Extra arguments go to `docker compose down`, e.g. `sh scripts/down.sh -v`.
set -eu
cd "$(dirname "$0")/.."
docker compose down --remove-orphans "$@"
