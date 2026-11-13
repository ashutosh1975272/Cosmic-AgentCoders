#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$DIR/Building-cosmic/launch-cosmic.sh" ]; then
  exec "$DIR/Building-cosmic/launch-cosmic.sh" "$@"
fi

echo "Error: Building-cosmic/launch-cosmic.sh not found." >&2
exit 1
