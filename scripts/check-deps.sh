#!/usr/bin/env bash
# Verifies external CLI dependencies for yt-dlp-fork.
# Exits non-zero if anything is missing, so `npm run setup` fails predictably.

set -u

missing=0

check() {
  local name="$1"
  local version_cmd="$2"
  local brew_pkg="$3"
  local note="${4:-}"

  if ! command -v "$name" >/dev/null 2>&1; then
    echo "  MISSING  $name"
    echo "           install:  brew install $brew_pkg"
    [ -n "$note" ] && echo "           note:     $note"
    missing=$((missing + 1))
    return
  fi

  local version
  version=$(eval "$version_cmd" 2>/dev/null | head -n1)
  echo "  OK       $name  ($version)"
}

echo "Checking external dependencies..."
echo

check "yt-dlp" "yt-dlp --version" "yt-dlp"
check "ffmpeg" "ffmpeg -version" "ffmpeg"
check "deno"   "deno --version"   "deno" "required for YouTube's JS challenge step"

echo
if [ "$missing" -gt 0 ]; then
  echo "$missing dependency(ies) missing. Install the brew packages above and re-run."
  echo "If you don't have Homebrew:  https://brew.sh"
  exit 1
fi

echo "All dependencies present."
