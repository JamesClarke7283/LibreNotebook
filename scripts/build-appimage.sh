#!/usr/bin/env bash
# Build an AppImage from dist/AppDir.
# Output: dist/LibreNotebook-<version>-x86_64.AppImage
#
# Downloads appimagetool to dist/appimagetool on first run.
# If FUSE 2 isn't available (e.g. inside containers), runs
# appimagetool with --appimage-extract-and-run.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build.sh"

DIST="$ROOT/dist"
APPDIR="$DIST/AppDir"
. "$DIST/build.env"

TOOL="$DIST/appimagetool"
if [ ! -x "$TOOL" ]; then
  echo "==> downloading appimagetool"
  curl -L --fail --max-time 60 \
    -o "$TOOL" \
    "https://github.com/AppImage/appimagetool/releases/latest/download/appimagetool-x86_64.AppImage"
  chmod +x "$TOOL"
fi

OUT="$DIST/LibreNotebook-${VERSION}-${ARCH_APPIMAGE}.AppImage"

# appimagetool itself wants FUSE; honour --appimage-extract-and-run when
# we can't talk to /dev/fuse.
RUN_FLAGS=()
if [ ! -e /dev/fuse ] || ! [ -r /dev/fuse ]; then
  RUN_FLAGS+=( --appimage-extract-and-run )
fi

ARCH=x86_64 "$TOOL" "${RUN_FLAGS[@]}" "$APPDIR" "$OUT"
echo "==> $OUT"
