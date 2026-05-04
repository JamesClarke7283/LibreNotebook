#!/usr/bin/env bash
# Build a Debian package: dist/librenotebook_<version>_<arch>.deb
#
# Lays the AppDir contents into /usr/lib/librenotebook (binaries) and
# /usr/{bin,share} (launcher + desktop entry + icon), writes
# DEBIAN/control, then runs `dpkg-deb --build`.
#
# Requires: dpkg-deb, the same tools as build.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build.sh"

DIST="$ROOT/dist"
APPDIR="$DIST/AppDir"
. "$DIST/build.env"

if [ "${TARGET_OS:-}" != "linux" ]; then
  echo "build-deb.sh: TARGET_OS=${TARGET_OS:-?} — .deb is Linux-only" >&2
  exit 64
fi

DEBROOT="$DIST/deb"
rm -rf "$DEBROOT"

mkdir -p "$DEBROOT/DEBIAN"
mkdir -p "$DEBROOT/usr/lib/librenotebook"
mkdir -p "$DEBROOT/usr/bin"
mkdir -p "$DEBROOT/usr/share/applications"
mkdir -p "$DEBROOT/usr/share/icons/hicolor/256x256/apps"

# Server + window binaries → /usr/lib/librenotebook.
cp "$APPDIR/usr/bin/librenotebook-server" "$DEBROOT/usr/lib/librenotebook/"
if [ -x "$APPDIR/usr/bin/librenotebook-window" ]; then
  cp "$APPDIR/usr/bin/librenotebook-window" "$DEBROOT/usr/lib/librenotebook/"
fi
if [ -d "$APPDIR/usr/share/librenotebook/resources" ]; then
  mkdir -p "$DEBROOT/usr/share/librenotebook"
  cp -r "$APPDIR/usr/share/librenotebook/resources" \
        "$DEBROOT/usr/share/librenotebook/resources"
fi

# Launcher → /usr/bin (it auto-resolves binaries via the search order
# baked into build.sh).
cp "$APPDIR/usr/bin/librenotebook" "$DEBROOT/usr/bin/librenotebook"
chmod +x "$DEBROOT/usr/bin/librenotebook"

# Icon + desktop entry.
if [ -e "$APPDIR/usr/share/icons/hicolor/256x256/apps/librenotebook.png" ]; then
  cp "$APPDIR/usr/share/icons/hicolor/256x256/apps/librenotebook.png" \
     "$DEBROOT/usr/share/icons/hicolor/256x256/apps/"
fi
cp "$APPDIR/usr/share/applications/librenotebook.desktop" \
   "$DEBROOT/usr/share/applications/"

# Compute installed-size (KiB) for the control file.
INSTALLED_SIZE=$(du -sk "$DEBROOT" | cut -f1)

cat > "$DEBROOT/DEBIAN/control" <<EOF
Package: librenotebook
Version: $VERSION
Section: misc
Priority: optional
Architecture: $ARCH_DEB
Installed-Size: $INSTALLED_SIZE
Depends: ca-certificates, libgtk-3-0, libwebkit2gtk-4.1-0 | libwebkit2gtk-4.0-37
Recommends: yt-dlp
Maintainer: LibreNotebook <noreply@librenotebook.local>
Homepage: https://github.com/impulse/LibreNotebook
Description: Open-source NotebookLM (offline-first AI notebook)
 LibreNotebook is an open-source NotebookLM alternative built on
 Deno + Fresh, with retrieval-augmented chat, PDF / webpage / YouTube
 ingestion, and Mermaid infographic generation. AGPL-v3-or-later.
EOF

OUT="$DIST/librenotebook_${VERSION}_${ARCH_DEB}.deb"
dpkg-deb --build --root-owner-group "$DEBROOT" "$OUT"
echo "==> $OUT"
