#!/bin/sh
# Starts the 3-service stack (web, backend-java, backend-go) on free host ports.
#
# For each port (WEB_PORT, BACKEND_JAVA_PORT, BACKEND_GO_PORT) it takes the
# environment value, else the one in .env, else the default (3000, 8090, 8091).
# BACKEND_PORT is a deprecated alias of BACKEND_JAVA_PORT (used when the latter is unset).
# A port held by another process is skipped for the next free one; a port held
# by this compose project's container of the same service is reused.
#
# Usage: sh scripts/up.sh [--dry-run]
#   --dry-run  only print "WEB_PORT=… BACKEND_JAVA_PORT=… BACKEND_GO_PORT=…"
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) sed -n '2,10s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) echo "up.sh: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

MAX_TRIES=100

# from_dotenv KEY -> last KEY=value in .env (quotes and CR stripped), or empty
from_dotenv() {
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -n 1 | tr -d "\"'\r"
}

# setting KEY DEFAULT -> environment, else .env, else DEFAULT
setting() {
  eval "value=\${$1:-}"
  [ -n "$value" ] || value=$(from_dotenv "$1")
  [ -n "$value" ] || value=$2
  printf '%s' "$value"
}

# Same precedence as docker compose: COMPOSE_PROJECT_NAME, else the directory
# name lowercased with characters other than [a-z0-9_-] removed.
project_name() {
  name=$(setting COMPOSE_PROJECT_NAME "$(basename "$ROOT")")
  printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-'
}

PROJECT=$(project_name)

# port_in_use PORT -> 0 when something listens on PORT (any available tool says so)
port_in_use() {
  if command -v lsof >/dev/null 2>&1 \
    && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1 \
    && [ -n "$(ss -Htln "sport = :$1" 2>/dev/null)" ]; then
    return 0
  fi
  if command -v nc >/dev/null 2>&1 \
    && nc -z -w 1 127.0.0.1 "$1" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# held_by_service PORT SERVICE -> 0 when the running container of SERVICE in
# $PROJECT publishes PORT (another service's port is never reused for this one)
held_by_service() {
  command -v docker >/dev/null 2>&1 || return 1
  docker ps --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$2" --format '{{.Ports}}' 2>/dev/null \
    | grep -q ":$1->"
}

CHOSEN=" "

# pick NAME START SERVICE -> sets PICKED to START or the next port that is free (or
# held by SERVICE's own container) and not chosen yet. Runs in this shell, not
# in $(…), so CHOSEN accumulates.
pick() {
  case "$2" in
    '' | *[!0-9]*) echo "up.sh: $1='$2' is not a port number" >&2; exit 2 ;;
  esac
  port=$2
  tries=0
  while [ "$tries" -lt "$MAX_TRIES" ] && [ "$port" -le 65535 ]; do
    case "$CHOSEN" in
      *" $port "*) ;;
      *)
        if held_by_service "$port" "$3" || ! port_in_use "$port"; then
          [ "$port" = "$2" ] || echo "up.sh: $1 $2 is taken, using $port" >&2
          CHOSEN="$CHOSEN$port "
          PICKED=$port
          return 0
        fi
        ;;
    esac
    port=$((port + 1))
    tries=$((tries + 1))
  done
  echo "up.sh: no free port for $1 in $2..$port" >&2
  exit 1
}

pick WEB_PORT "$(setting WEB_PORT 3000)" web
WEB_PORT=$PICKED
JAVA_PORT_WANTED=$(setting BACKEND_JAVA_PORT "")
if [ -z "$JAVA_PORT_WANTED" ]; then
  JAVA_PORT_WANTED=$(setting BACKEND_PORT "")
  [ -z "$JAVA_PORT_WANTED" ] || echo "up.sh: BACKEND_PORT is deprecated, use BACKEND_JAVA_PORT" >&2
fi
pick BACKEND_JAVA_PORT "${JAVA_PORT_WANTED:-8090}" backend-java
BACKEND_JAVA_PORT=$PICKED
pick BACKEND_GO_PORT "$(setting BACKEND_GO_PORT 8091)" backend-go
BACKEND_GO_PORT=$PICKED

if [ "$DRY_RUN" -eq 1 ]; then
  echo "WEB_PORT=$WEB_PORT BACKEND_JAVA_PORT=$BACKEND_JAVA_PORT BACKEND_GO_PORT=$BACKEND_GO_PORT"
  exit 0
fi

export WEB_PORT BACKEND_JAVA_PORT BACKEND_GO_PORT
# --remove-orphans: drops containers of services no longer in the file (e.g. the old `backend`)
UP_STATUS=0
docker compose up --build -d --wait --remove-orphans || UP_STATUS=$?

echo
echo "Web:          http://localhost:$WEB_PORT"
echo "Java Swagger: http://localhost:$BACKEND_JAVA_PORT/swagger-ui.html"
echo "Go Swagger:   http://localhost:$BACKEND_GO_PORT/swagger-ui.html"

if [ "$UP_STATUS" -ne 0 ]; then
  # Services not running, or running with a health other than healthy (no healthcheck = empty)
  UNHEALTHY=$(docker compose ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null \
    | awk '$1 != "" && ($2 != "running" || ($3 != "" && $3 != "healthy")) { printf "%s%s", sep, $1; sep = ", " }')
  echo >&2
  if [ -n "$UNHEALTHY" ]; then
    echo "up.sh: WARNING: not healthy: $UNHEALTHY (docker compose up exited $UP_STATUS)." >&2
    echo "up.sh: the other backend keeps serving; check 'docker compose logs <service>'." >&2
  else
    echo "up.sh: WARNING: docker compose up exited $UP_STATUS (see the output above)." >&2
  fi
  exit "$UP_STATUS"
fi
