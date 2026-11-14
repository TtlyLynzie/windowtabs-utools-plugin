#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_PATH="${1:-$ROOT_DIR/dist/windowtabs-utools-plugin.upx}"

test -f "$PACKAGE_PATH"
command -v unzip >/dev/null 2>&1 || { echo "unzip is required" >&2; exit 127; }

entries="$(unzip -Z1 "$PACKAGE_PATH")"
for required in plugin.json index.html preload.js renderer.js styles.css logo.png helper/current.json LICENSES/WindowTabs-MIT.txt THIRD-PARTY-NOTICES.md SOURCE-BUILD.md audit/source-manifest.json; do
  grep -Fxq "$required" <<<"$entries" || { echo "missing package entry: $required" >&2; exit 1; }
done

helper_entry="$(grep -E '^helper/[^/]+/WindowTabs\.exe$' <<<"$entries" | head -n 1)"
test -n "$helper_entry" || { echo "missing bundled WindowTabs.exe" >&2; exit 1; }

for forbidden in README.md native/WindowTabsIpc.fs patches/upstream-ipc.patch build/core-manifest.json tests/smoke-test.mjs dev/mock-helper.js mock.js; do
  if grep -Fxq "$forbidden" <<<"$entries"; then
    echo "unnecessary package entry: $forbidden" >&2
    exit 1
  fi
done

grep -E '^audit/patches/[^/]+\.txt$' <<<"$entries" >/dev/null || { echo "missing bundled audit patch" >&2; exit 1; }

helper_count="$(grep -E '^helper/[^/]+/WindowTabs\.exe$' <<<"$entries" | wc -l | tr -d ' ')"
test "$helper_count" = "1" || { echo "package must contain exactly one active WindowTabs.exe" >&2; exit 1; }
if grep -E '^helper/[^/]+/(README\.txt|version\.md)$' <<<"$entries" >/dev/null; then
  echo "unnecessary helper documentation found in package" >&2
  exit 1
fi
echo "package valid: $PACKAGE_PATH ($helper_entry)"
