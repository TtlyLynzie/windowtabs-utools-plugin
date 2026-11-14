#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:?market directory is required}"
test -f "$ROOT_DIR/plugin.json"
test -f "$ROOT_DIR/index.html"
test -f "$ROOT_DIR/preload.js"
test -f "$ROOT_DIR/renderer.js"
test -f "$ROOT_DIR/styles.css"
test -f "$ROOT_DIR/logo.png"
test -f "$ROOT_DIR/settings-model.js"
test -f "$ROOT_DIR/settings-schema.json"
test -f "$ROOT_DIR/helper/current.json"
test -f "$ROOT_DIR/LICENSES/WindowTabs-MIT.txt"
test -f "$ROOT_DIR/THIRD-PARTY-NOTICES.md"
test -f "$ROOT_DIR/SOURCE-BUILD.md"
test -f "$ROOT_DIR/audit/source-manifest.json"
test ! -e "$ROOT_DIR/mock.js"

helper_count="$(find "$ROOT_DIR/helper" -type f -name 'WindowTabs.exe' | wc -l | tr -d ' ')"
test "$helper_count" = "1" || { echo "market directory must contain exactly one WindowTabs.exe" >&2; exit 1; }

if find "$ROOT_DIR/helper" -type f \( -name 'README.txt' -o -name 'version.md' \) | grep -q .; then
  echo "market directory contains helper documentation" >&2
  exit 1
fi
for forbidden in README.md native patches build scripts tests dev; do
  test ! -e "$ROOT_DIR/$forbidden" || { echo "unnecessary market entry: $forbidden" >&2; exit 1; }
done
for entry in "$ROOT_DIR"/*; do
  case "$(basename "$entry")" in
    plugin.json|index.html|preload.js|renderer.js|styles.css|logo.png|settings-model.js|settings-schema.json|helper|LICENSES|THIRD-PARTY-NOTICES.md|SOURCE-BUILD.md|audit) ;;
    *) echo "Unexpected marketplace entry: $entry" >&2; exit 1 ;;
  esac
done
test "$(find "$ROOT_DIR/LICENSES" -maxdepth 1 -type f | wc -l | tr -d ' ')" = "1"
test "$(find "$ROOT_DIR/audit" -type f -name 'source-manifest.json' | wc -l | tr -d ' ')" = "1"
test "$(find "$ROOT_DIR/audit" -type f -name '*.txt' | wc -l | tr -d ' ')" = "1"
if find "$ROOT_DIR" -type f -name 'mock.js' | grep -q .; then
  echo "market directory contains development mock.js" >&2
  exit 1
fi
echo "market directory valid: $ROOT_DIR"
