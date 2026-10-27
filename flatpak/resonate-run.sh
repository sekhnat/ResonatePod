#!/bin/sh
# zypak lets Chromium's sandbox work inside the Flatpak sandbox.
exec zypak-wrapper /app/resonate/resonate "$@"
