#!/bin/sh
# Shell test for scripts/up.sh (POSIX sh, macOS and Linux).
#   1. A port held by another process (python3 -m http.server) is skipped.
#   2. A port held by a container of this compose project is reused
#      (docker is replaced by a stub on PATH, so no Docker is needed).
#   3. A port held by another service of the project is not reused for a
#      different service (reuse is per service, not per project).
#   4. When `docker compose up --wait` fails, the URLs are still printed with a
#      warning naming the unhealthy service(s), and up.sh exits non-zero.
#   5. The deprecated BACKEND_PORT still sets the Java port (with a notice).
# Usage: sh scripts/up.test.sh
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
UP="$ROOT/scripts/up.sh"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/up-test.XXXXXX")
SERVER_PID=""
FAILURES=0

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

fail() { echo "FAIL: $*"; FAILURES=$((FAILURES + 1)); }
pass() { echo "PASS: $*"; }

# value_of KEY "<dry-run output>" -> the value of KEY=… in that output
value_of() {
  printf '%s\n' "$2" | tr ' ' '\n' | sed -n "s/^$1=//p"
}

if [ ! -f "$UP" ]; then
  fail "scripts/up.sh does not exist"
  exit 1
fi

# --- 1. occupied port is skipped -------------------------------------------
PORT=""
candidate=39517
while [ "$candidate" -lt 39617 ]; do
  python3 -u -m http.server "$candidate" --bind 127.0.0.1 >"$TMP/http.log" 2>&1 &
  SERVER_PID=$!
  tries=0
  while [ "$tries" -lt 10 ]; do
    if grep -q "Serving HTTP" "$TMP/http.log" 2>/dev/null; then PORT=$candidate; break; fi
    kill -0 "$SERVER_PID" 2>/dev/null || break
    sleep 1
    tries=$((tries + 1))
  done
  [ -n "$PORT" ] && break
  kill "$SERVER_PID" 2>/dev/null
  SERVER_PID=""
  candidate=$((candidate + 1))
done

if [ -z "$PORT" ]; then
  fail "could not occupy a port with python3 -m http.server"
  exit 1
fi

OUT=$(COMPOSE_PROJECT_NAME=up-test-$$ WEB_PORT=$PORT BACKEND_JAVA_PORT=39700 BACKEND_GO_PORT=39701 \
  sh "$UP" --dry-run 2>"$TMP/err")
STATUS=$?
CHOSEN=$(value_of WEB_PORT "$OUT")
if [ "$STATUS" -ne 0 ]; then
  fail "up.sh --dry-run exited $STATUS: $(cat "$TMP/err")"
elif [ -z "$CHOSEN" ]; then
  fail "no WEB_PORT in dry-run output: '$OUT'"
elif [ "$CHOSEN" = "$PORT" ]; then
  fail "occupied port $PORT was chosen for WEB_PORT"
else
  pass "occupied WEB_PORT $PORT skipped, chose $CHOSEN ($OUT)"
fi
case "$OUT" in
  "WEB_PORT=$CHOSEN BACKEND_JAVA_PORT="*" BACKEND_GO_PORT="*) ;;
  *) fail "dry-run output format: '$OUT'" ;;
esac

# --- 2. port held by this compose project's own container is reused --------
mkdir -p "$TMP/bin"
cat >"$TMP/bin/docker" <<EOF
#!/bin/sh
# stub: 'docker ps --filter label=com.docker.compose.project=up-test-own ...'
case "\$*" in
  *com.docker.compose.project=up-test-own*) echo "0.0.0.0:$PORT->80/tcp, [::]:$PORT->80/tcp" ;;
esac
EOF
chmod +x "$TMP/bin/docker"

OUT=$(PATH="$TMP/bin:$PATH" COMPOSE_PROJECT_NAME=up-test-own WEB_PORT=$PORT BACKEND_JAVA_PORT=39700 \
  BACKEND_GO_PORT=39701 sh "$UP" --dry-run 2>"$TMP/err")
CHOSEN=$(value_of WEB_PORT "$OUT")
if [ "$CHOSEN" = "$PORT" ]; then
  pass "WEB_PORT $PORT held by this project's container is reused"
else
  fail "own-project port $PORT not reused (got '$OUT', stderr: $(cat "$TMP/err"))"
fi

# --- 3. port held by another service of the project is not reused ----------
mkdir -p "$TMP/bin3"
cat >"$TMP/bin3/docker" <<EOF
#!/bin/sh
# stub: the project's 'web' container publishes $PORT; no other service does.
# Unfiltered by service it lists every container of the project.
case "\$*" in
  *com.docker.compose.project=up-test-svc*com.docker.compose.service=web*) echo "0.0.0.0:$PORT->80/tcp" ;;
  *com.docker.compose.service=*) ;;
  *com.docker.compose.project=up-test-svc*) echo "0.0.0.0:$PORT->80/tcp" ;;
esac
EOF
chmod +x "$TMP/bin3/docker"

OUT=$(PATH="$TMP/bin3:$PATH" COMPOSE_PROJECT_NAME=up-test-svc WEB_PORT=39702 BACKEND_JAVA_PORT=$PORT \
  BACKEND_GO_PORT=39703 sh "$UP" --dry-run 2>"$TMP/err")
JAVA=$(value_of BACKEND_JAVA_PORT "$OUT")
if [ -z "$JAVA" ]; then
  fail "no BACKEND_JAVA_PORT in dry-run output: '$OUT' (stderr: $(cat "$TMP/err"))"
elif [ "$JAVA" = "$PORT" ]; then
  fail "port $PORT held by the project's web container was reused for BACKEND_JAVA_PORT"
else
  pass "port $PORT held by service web is not reused for backend-java (chose $JAVA)"
fi
OUT=$(PATH="$TMP/bin3:$PATH" COMPOSE_PROJECT_NAME=up-test-svc WEB_PORT=$PORT BACKEND_JAVA_PORT=39700 \
  BACKEND_GO_PORT=39703 sh "$UP" --dry-run 2>"$TMP/err")
if [ "$(value_of WEB_PORT "$OUT")" = "$PORT" ]; then
  pass "port $PORT held by service web is reused for WEB_PORT"
else
  fail "web's own port $PORT not reused for WEB_PORT (got '$OUT')"
fi

# --- 4. failed 'up --wait': URLs printed, unhealthy service named, exit != 0 -
mkdir -p "$TMP/bin4"
cat >"$TMP/bin4/docker" <<'STUB'
#!/bin/sh
case "$*" in
  "compose up"*) echo "dependency failed to start: container backend-go is unhealthy" >&2; exit 1 ;;
  "compose ps"*) printf 'backend-go running unhealthy\nbackend-java running healthy\nweb running \n' ;;
esac
exit 0
STUB
chmod +x "$TMP/bin4/docker"

OUT=$(PATH="$TMP/bin4:$PATH" COMPOSE_PROJECT_NAME=up-test-fail WEB_PORT=39704 BACKEND_JAVA_PORT=39705 \
  BACKEND_GO_PORT=39706 sh "$UP" 2>"$TMP/err")
STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  fail "up.sh exited 0 although 'docker compose up' failed"
else
  pass "up.sh exits $STATUS when 'docker compose up' fails"
fi
case "$OUT" in
  *"http://localhost:39704"*) pass "URLs still printed after a failed up" ;;
  *) fail "URLs not printed after a failed up (stdout: '$OUT')" ;;
esac
WARNING=$(grep -i "warning" "$TMP/err")
case "$WARNING" in
  *backend-java* | *web*) fail "warning names a healthy service: '$WARNING'" ;;
  *backend-go*) pass "warning names the unhealthy service: '$WARNING'" ;;
  *) fail "no warning naming backend-go (stderr: $(cat "$TMP/err"))" ;;
esac

# --- 5. deprecated BACKEND_PORT is honoured for Java, with a notice ----------
OUT=$(COMPOSE_PROJECT_NAME=up-test-old WEB_PORT=39707 BACKEND_PORT=39708 BACKEND_GO_PORT=39709 \
  sh "$UP" --dry-run 2>"$TMP/err")
if [ "$(value_of BACKEND_JAVA_PORT "$OUT")" = "39708" ]; then
  pass "only BACKEND_PORT set: used for BACKEND_JAVA_PORT"
else
  fail "BACKEND_PORT not used for Java (got '$OUT')"
fi
if grep -q "BACKEND_PORT is deprecated" "$TMP/err"; then
  pass "deprecation notice printed"
else
  fail "no deprecation notice (stderr: $(cat "$TMP/err"))"
fi
OUT=$(COMPOSE_PROJECT_NAME=up-test-old WEB_PORT=39707 BACKEND_JAVA_PORT=39710 BACKEND_PORT=39708 \
  BACKEND_GO_PORT=39709 sh "$UP" --dry-run 2>"$TMP/err")
if [ "$(value_of BACKEND_JAVA_PORT "$OUT")" = "39710" ] && ! grep -q deprecated "$TMP/err"; then
  pass "BACKEND_JAVA_PORT wins over BACKEND_PORT, no notice"
else
  fail "BACKEND_JAVA_PORT precedence (got '$OUT')"
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "$FAILURES failure(s)"
  exit 1
fi
echo "OK"
