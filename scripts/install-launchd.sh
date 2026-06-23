#!/usr/bin/env bash
# Installs a launchd user agent that auto-starts the API on login and
# restarts it if it crashes. Idempotent: safe to re-run.
#
# Reads TLS_CERT_PATH and TLS_KEY_PATH from the project's .env (if set)
# and bakes them into the plist's EnvironmentVariables so HTTPS works
# without you having to source .env inside launchd.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.yt-dlp-fork.api"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/yt-dlp-fork"
UID_NUM=$(id -u)

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "node not on PATH. Install Node 22 LTS first (`nvm install 22`)." >&2
  exit 1
fi

MAIN_JS="$PROJECT_ROOT/api/dist/main.js"
if [ ! -f "$MAIN_JS" ]; then
  echo "Build not found at $MAIN_JS. Run 'npm run build' first." >&2
  exit 1
fi

ENV_FILE="$PROJECT_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo ".env not found at $ENV_FILE. Copy from .env.example and fill in AUTH_TOKEN." >&2
  exit 1
fi

# Read selected vars from .env (everything else is loaded via @nestjs/config).
get_env() {
  local key="$1"
  local val
  val=$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2- | sed 's/^"//; s/"$//')
  printf '%s' "$val"
}

TLS_CERT_PATH=$(get_env TLS_CERT_PATH)
TLS_KEY_PATH=$(get_env TLS_KEY_PATH)

mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--env-file=$ENV_FILE</string>
    <string>$MAIN_JS</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$PROJECT_ROOT</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
PLIST

if [ -n "$TLS_CERT_PATH" ] && [ -n "$TLS_KEY_PATH" ]; then
  cat >> "$PLIST_PATH" <<PLIST
    <key>TLS_CERT_PATH</key>
    <string>$TLS_CERT_PATH</string>
    <key>TLS_KEY_PATH</key>
    <string>$TLS_KEY_PATH</string>
PLIST
fi

cat >> "$PLIST_PATH" <<PLIST
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
    <key>Crashed</key>
    <true/>
  </dict>

  <key>ProcessType</key>
  <string>Background</string>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/stdout.log</string>

  <key>StandardErrorPath</key>
  <string>$LOG_DIR/stderr.log</string>
</dict>
</plist>
PLIST

# Reload: bootout if already loaded, then bootstrap.
launchctl bootout "gui/$UID_NUM" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST_PATH"
launchctl enable "gui/$UID_NUM/$LABEL"

echo "Installed: $PLIST_PATH"
echo
echo "Status:"
launchctl print "gui/$UID_NUM/$LABEL" 2>/dev/null | grep -E '^(\s+)?(state|pid|program|path)' || true
echo
echo "Logs:"
echo "  $LOG_DIR/stdout.log"
echo "  $LOG_DIR/stderr.log"
echo
if [ -n "$TLS_CERT_PATH" ] && [ -n "$TLS_KEY_PATH" ]; then
  echo "TLS enabled. API listens on https://localhost:8787"
else
  echo "No TLS. API listens on http://localhost:8787 (run scripts/issue-tls.sh to enable HTTPS)."
fi
