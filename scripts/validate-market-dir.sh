#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:?market directory is required}"
test -f "$ROOT_DIR/plugin.json"
test -f "$ROOT_DIR/index.html"
test -f "$ROOT_DIR/preload.js"
test -f "$ROOT_DIR/renderer.js"
test -f "$ROOT_DIR/styles.css"
test -f "$ROOT_DIR/logo.png"
test -f "$ROOT_DIR/helper/current.json"

helper_count="$(find "$ROOT_DIR/helper" -type f -name 'WindowTabs.exe' | wc -l | tr -d ' ')"
test "$helper_count" = "1" || { echo "market directory must contain exactly one WindowTabs.exe" >&2; exit 1; }

if find "$ROOT_DIR/helper" -type f \( -name 'README.txt' -o -name 'version.md' \) | grep -q .; then
  echo "market directory contains helper documentation" >&2
  exit 1
fi
for forbidden in README.md native patches build scripts tests dev; do
  test ! -e "$ROOT_DIR/$forbidden" || { echo "unnecessary market entry: $forbidden" >&2; exit 1; }
done
echo "market directory valid: $ROOT_DIR"
