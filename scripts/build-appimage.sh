#!/usr/bin/env bash
# Build an AppImage from dist/AppDir.
# Output: dist/LibreNotebook-<version>-<arch>.AppImage   (arch = x86_64 | aarch64)
#
# Downloads appimagetool (always the x86_64 build — it's the runner
# binary; the AppImage it *produces* is whatever ARCH= we tell it).
# If FUSE 2 isn't available (e.g. inside containers), runs
# appimagetool with --appimage-extract-and-run.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build.sh"

DIST="$ROOT/dist"
APPDIR="$DIST/AppDir"
. "$DIST/build.env"

if [ "${TARGET_OS:-}" != "linux" ]; then
  echo "build-appimage.sh: TARGET_OS=${TARGET_OS:-?} — AppImage is Linux-only" >&2
  exit 64
fi

# appimagetool itself runs on the host. Pick the host-arch binary.
HOST_ARCH_TOOL=""
case "$(uname -m)" in
  x86_64|amd64) HOST_ARCH_TOOL="x86_64" ;;
  aarch64|arm64) HOST_ARCH_TOOL="aarch64" ;;
  *) HOST_ARCH_TOOL="x86_64" ;;
esac

TOOL="$DIST/appimagetool-${HOST_ARCH_TOOL}"
if [ ! -x "$TOOL" ]; then
  echo "==> downloading appimagetool ($HOST_ARCH_TOOL)"
  curl -L --fail --max-time 60 \
    -o "$TOOL" \
    "https://github.com/AppImage/appimagetool/releases/latest/download/appimagetool-${HOST_ARCH_TOOL}.AppImage"
  chmod +x "$TOOL"
fi

OUT="$DIST/LibreNotebook-${VERSION}-${ARCH_APPIMAGE}.AppImage"

# appimagetool itself wants FUSE; honour --appimage-extract-and-run when
# we can't talk to /dev/fuse.
RUN_FLAGS=()
if [ ! -e /dev/fuse ] || ! [ -r /dev/fuse ]; then
  RUN_FLAGS+=( --appimage-extract-and-run )
fi

# ARCH= tells appimagetool which AppImage runtime to embed (so the
# resulting AppImage runs on the *target* arch even when the tool
# itself is host-arch).
ARCH="$ARCH_APPIMAGE" "$TOOL" "${RUN_FLAGS[@]}" "$APPDIR" "$OUT"
echo "==> $OUT"
