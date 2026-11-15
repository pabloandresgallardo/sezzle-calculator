#!/bin/sh
# Fails when statement coverage of internal/... is below the threshold.
# Usage (from backend-go/): sh scripts/coverage-gate.sh <coverprofile> [min-percent, default 90]
# The profile comes from `go test -coverprofile=<file> ./...`; cmd/ is left out of the gate.
set -eu

PROFILE=${1:?usage: coverage-gate.sh <coverprofile> [min-percent]}
MIN=${2:-90}
export GO111MODULE=on

[ -s "$PROFILE" ] || { echo "coverage-gate: empty or missing profile '$PROFILE'" >&2; exit 2; }

FILTERED=$(mktemp "${TMPDIR:-/tmp}/cover-internal.XXXXXX")
trap 'rm -f "$FILTERED"' EXIT INT TERM

# keep the "mode:" header and the blocks of files under internal/
awk 'NR == 1 || /\/internal\//' "$PROFILE" >"$FILTERED"
[ "$(wc -l <"$FILTERED")" -gt 1 ] || { echo "coverage-gate: no internal/ blocks in '$PROFILE'" >&2; exit 2; }

TOTAL=$(go tool cover -func="$FILTERED" | awk '/^total:/ { sub(/%/, "", $NF); print $NF }')
[ -n "$TOTAL" ] || { echo "coverage-gate: could not read total coverage" >&2; exit 2; }

if awk -v t="$TOTAL" -v m="$MIN" 'BEGIN { exit !(t + 0 >= m + 0) }'; then
  echo "coverage-gate: internal/... ${TOTAL}% >= ${MIN}% OK"
else
  echo "coverage-gate: internal/... ${TOTAL}% < ${MIN}% FAIL" >&2
  exit 1
fi
