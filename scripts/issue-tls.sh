#!/usr/bin/env bash
# Issues a TLS cert for this Mac's tailnet hostname using `tailscale cert`,
# placing the files at .tls/<hostname>.crt and .tls/<hostname>.key.
#
# Tailscale must be running and the tailnet must have HTTPS certificates
# enabled in the admin console (Settings -> DNS -> HTTPS certificates).

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TLS_DIR="$PROJECT_ROOT/.tls"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale is not installed. Install from https://tailscale.com/download" >&2
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale is not logged in. Run: tailscale login" >&2
  exit 1
fi

HOSTNAME=$(tailscale status --json | python3 -c '
import json, sys
data = json.load(sys.stdin)
self_info = data.get("Self", {})
dns = self_info.get("DNSName") or ""
if dns.endswith("."):
    dns = dns[:-1]
print(dns)
')

if [ -z "$HOSTNAME" ]; then
  echo "Could not determine tailnet hostname from `tailscale status --json`." >&2
  exit 1
fi

echo "Issuing cert for: $HOSTNAME"
mkdir -p "$TLS_DIR"

tailscale cert \
  --cert-file "$TLS_DIR/$HOSTNAME.crt" \
  --key-file "$TLS_DIR/$HOSTNAME.key" \
  "$HOSTNAME"

chmod 600 "$TLS_DIR/$HOSTNAME.key"

echo
echo "Cert written to:"
echo "  $TLS_DIR/$HOSTNAME.crt"
echo "  $TLS_DIR/$HOSTNAME.key"
echo
echo "Add these to .env (or the launchd plist) to enable HTTPS:"
echo "  TLS_CERT_PATH=$TLS_DIR/$HOSTNAME.crt"
echo "  TLS_KEY_PATH=$TLS_DIR/$HOSTNAME.key"
echo
echo "Tailscale certs expire after ~90 days. Re-run this script to renew."
