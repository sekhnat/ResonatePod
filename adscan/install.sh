#!/usr/bin/env bash
# Install the hourly resonate-adscan timer as a systemd user unit; the driver does the rest.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.config/systemd/user"
mkdir -p "$DEST"
cp "$DIR/resonate-adscan.service" "$DIR/resonate-adscan.timer" "$DEST/"
systemctl --user daemon-reload
systemctl --user enable --now resonate-adscan.timer
echo "installed; next run:"
systemctl --user list-timers resonate-adscan.timer --no-pager | head -3
