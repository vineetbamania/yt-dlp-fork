#!/usr/bin/env bash
# Removes the launchd user agent installed by install-launchd.sh.

set -euo pipefail

LABEL="com.yt-dlp-fork.api"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM=$(id -u)

if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_NUM" "$PLIST_PATH" 2>/dev/null || true
  echo "Stopped: $LABEL"
fi

if [ -f "$PLIST_PATH" ]; then
  rm "$PLIST_PATH"
  echo "Removed: $PLIST_PATH"
else
  echo "Nothing to remove."
fi
