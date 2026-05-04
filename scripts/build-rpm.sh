#!/usr/bin/env bash
# Build an RPM package: dist/librenotebook-<version>-1.<arch>.rpm
#
# Lays the AppDir contents into the RPM's BUILDROOT, generates a
# minimal `.spec` file inline, then invokes `rpmbuild -bb`. The same
# /usr/{lib,bin,share} layout the .deb uses is reproduced here so the
# launcher script + binaries can sit at familiar paths.
#
# Requires: rpmbuild (rpm-build package on Fedora / RHEL / openSUSE
# Tumbleweed; pacman -S rpm-tools on Arch).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build.sh"

DIST="$ROOT/dist"
APPDIR="$DIST/AppDir"
. "$DIST/build.env"

if [ "${TARGET_OS:-}" != "linux" ]; then
  echo "build-rpm.sh: TARGET_OS=${TARGET_OS:-?} — .rpm is Linux-only" >&2
  exit 64
fi

# RPM_ARCH comes from build.env (x86_64 / aarch64). Fall back if absent.
RPM_ARCH="${RPM_ARCH:-x86_64}"

RPM_TOP="$DIST/rpm"
BUILDROOT="$RPM_TOP/BUILDROOT/librenotebook-${VERSION}-1.${RPM_ARCH}"
SPECS="$RPM_TOP/SPECS"
RPMS="$RPM_TOP/RPMS"
SOURCES="$RPM_TOP/SOURCES"
SRPMS="$RPM_TOP/SRPMS"
BUILD="$RPM_TOP/BUILD"

rm -rf "$RPM_TOP"
mkdir -p "$BUILDROOT" "$SPECS" "$RPMS" "$SOURCES" "$SRPMS" "$BUILD"

# Mirror the deb layout under BUILDROOT.
mkdir -p "$BUILDROOT/usr/lib/librenotebook"
mkdir -p "$BUILDROOT/usr/bin"
mkdir -p "$BUILDROOT/usr/share/applications"
mkdir -p "$BUILDROOT/usr/share/icons/hicolor/256x256/apps"

cp "$APPDIR/usr/bin/librenotebook-server" "$BUILDROOT/usr/lib/librenotebook/"
if [ -x "$APPDIR/usr/bin/librenotebook-window" ]; then
  cp "$APPDIR/usr/bin/librenotebook-window" "$BUILDROOT/usr/lib/librenotebook/"
fi
if [ -d "$APPDIR/usr/share/librenotebook/resources" ]; then
  mkdir -p "$BUILDROOT/usr/share/librenotebook"
  cp -r "$APPDIR/usr/share/librenotebook/resources" \
        "$BUILDROOT/usr/share/librenotebook/resources"
fi
cp "$APPDIR/usr/bin/librenotebook" "$BUILDROOT/usr/bin/librenotebook"
chmod +x "$BUILDROOT/usr/bin/librenotebook"

if [ -e "$APPDIR/usr/share/icons/hicolor/256x256/apps/librenotebook.png" ]; then
  cp "$APPDIR/usr/share/icons/hicolor/256x256/apps/librenotebook.png" \
     "$BUILDROOT/usr/share/icons/hicolor/256x256/apps/"
fi
cp "$APPDIR/usr/share/applications/librenotebook.desktop" \
   "$BUILDROOT/usr/share/applications/"

# Spec file. Minimal — we point it at the pre-laid-out BUILDROOT and
# enumerate %files explicitly. No %prep / %build / %install needed
# because the tree is already populated.
SPEC="$SPECS/librenotebook.spec"
cat > "$SPEC" <<EOF
Name:           librenotebook
Version:        $VERSION
Release:        1%{?dist}
Summary:        Open-source NotebookLM (offline-first AI notebook)
License:        AGPL-3.0-or-later
URL:            https://github.com/impulse/LibreNotebook
BuildArch:      $RPM_ARCH

Requires:       ca-certificates
Requires:       gtk3
# WebKit2GTK 4.1 (Fedora 38+) or fall back to 4.0 on older systems.
Requires:       (webkit2gtk4.1 or webkit2gtk4.0)
Recommends:     yt-dlp

# We've already produced files under BUILDROOT — skip rpmbuild's
# default %install and turn off debuginfo packaging.
%define _build_id_links none
%define debug_package %{nil}
AutoReqProv:    no
%global __os_install_post %{nil}

%description
LibreNotebook is an open-source NotebookLM alternative built on
Deno + Fresh, with retrieval-augmented chat, PDF / webpage / YouTube
ingestion, and Mermaid infographic generation. AGPL-v3-or-later.

%files
%attr(0755,root,root) /usr/bin/librenotebook
%attr(0755,root,root) /usr/lib/librenotebook/librenotebook-server
EOF

# Optional bits (only emit %files lines for what's actually present).
if [ -x "$BUILDROOT/usr/lib/librenotebook/librenotebook-window" ]; then
  echo '%attr(0755,root,root) /usr/lib/librenotebook/librenotebook-window' >> "$SPEC"
fi
if [ -d "$BUILDROOT/usr/share/librenotebook/resources" ]; then
  echo '/usr/share/librenotebook/resources/' >> "$SPEC"
fi
cat >> "$SPEC" <<'EOF'
/usr/share/applications/librenotebook.desktop
/usr/share/icons/hicolor/256x256/apps/librenotebook.png

%post
update-desktop-database -q || true
gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true

%postun
update-desktop-database -q || true
gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true

%changelog
EOF

printf '* %s LibreNotebook <noreply@librenotebook.local> - %s-1\n- Automated build.\n' \
  "$(date '+%a %b %d %Y')" "$VERSION" >> "$SPEC"

rpmbuild --define "_topdir $RPM_TOP" \
         --define "_buildrootdir $RPM_TOP/BUILDROOT" \
         --buildroot "$BUILDROOT" \
         --target "$RPM_ARCH" \
         -bb "$SPEC"

OUT="$DIST/librenotebook-${VERSION}-1.${RPM_ARCH}.rpm"
cp "$RPMS/${RPM_ARCH}/librenotebook-${VERSION}-1.${RPM_ARCH}.rpm" "$OUT"
echo "==> $OUT"
