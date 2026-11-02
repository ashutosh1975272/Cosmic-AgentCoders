#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Check if dist AppImage exists, run it if present
APPIMAGE="$(find dist -name "Cosmic-*.AppImage" 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$APPIMAGE" ] && [ -f "$APPIMAGE" ]; then
  echo "Launching built Cosmic AppImage: $APPIMAGE"
  chmod +x "$APPIMAGE"
  exec "$APPIMAGE" --no-sandbox "$@"
fi

# Otherwise, build and run directly
echo "Launching Cosmic..."
pnpm run build || npm run build
ELECTRON_OZONE_PLATFORM_HINT=x11 ./node_modules/.pnpm/electron@*/node_modules/electron/dist/electron out/main/index.js --no-sandbox --disable-dev-shm-usage --disable-gpu --disable-gpu-compositing --ozone-platform=x11 "$@"

