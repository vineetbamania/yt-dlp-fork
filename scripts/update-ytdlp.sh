#!/usr/bin/env bash
# Updates yt-dlp via the right channel for how it was installed.
# - If installed via Homebrew: `brew upgrade yt-dlp`
# - Otherwise: `yt-dlp -U` (works for pip / standalone binary installs)

set -eu

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp is not installed. Run: brew install yt-dlp"
  exit 1
fi

ytdlp_path=$(command -v yt-dlp)
echo "Found yt-dlp at: $ytdlp_path"

# Resolve symlinks so brew-shimmed binaries point at the Cellar path.
resolved=$(readlink -f "$ytdlp_path" 2>/dev/null || python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$ytdlp_path")

if [[ "$resolved" == *"/Cellar/"* ]] || [[ "$resolved" == *"/homebrew/"* ]]; then
  echo "Installed via Homebrew. Running: brew upgrade yt-dlp"
  brew upgrade yt-dlp
else
  echo "Not a Homebrew install. Running: yt-dlp -U"
  yt-dlp -U
fi

echo
echo "Now on: $(yt-dlp --version)"
