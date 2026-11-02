#!/usr/bin/env bash
set -euo pipefail

# Resolves directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ICON_PATH="${PROJECT_ROOT}/build/icons/256x256.png"
DESKTOP_DIR="${HOME}/.local/share/applications"
DESKTOP_FILE="${DESKTOP_DIR}/cosmic.desktop"

mkdir -p "${DESKTOP_DIR}"

# Find AppImage if built, or fallback to dev launch script
APPIMAGE_PATH="$(find "${PROJECT_ROOT}/dist" -name "Cosmic-*.AppImage" 2>/dev/null | sort -V | tail -n 1 || true)"

if [[ -n "${APPIMAGE_PATH}" && -f "${APPIMAGE_PATH}" ]]; then
  EXEC_CMD="${APPIMAGE_PATH} --no-sandbox"
  echo "Linking desktop launcher to built AppImage: ${APPIMAGE_PATH}"
else
  EXEC_CMD="${PROJECT_ROOT}/scripts/launch-cosmic.sh"
  echo "AppImage not found in dist/. Linking desktop launcher to development runner: ${EXEC_CMD}"
fi

cat <<EOF > "${DESKTOP_FILE}"
[Desktop Entry]
Name=Cosmic
Comment=Multi-profile Slack and Automation Dashboard
Exec=${EXEC_CMD} %U
Icon=${ICON_PATH}
Terminal=false
Type=Application
Categories=Utility;Network;Chat;
StartupWMClass=Cosmic
MimeType=x-scheme-handler/cosmic;x-scheme-handler/slack-dashboard;
EOF

chmod +x "${DESKTOP_FILE}"
if [[ -n "${APPIMAGE_PATH}" && -f "${APPIMAGE_PATH}" ]]; then
  chmod +x "${APPIMAGE_PATH}"
fi

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${DESKTOP_DIR}" || true
fi

echo "✅ Cosmic desktop launcher installed successfully at: ${DESKTOP_FILE}"
echo "You can now find and launch 'Cosmic' from your Ubuntu Applications / Dock!"
