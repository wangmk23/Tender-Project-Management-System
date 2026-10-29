#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ ${1:-} == --plan ]]; then
  python3 -m json.tool "$ROOT/tools/media_engine/sources.json"
  exit 0
fi
if [[ $# != 2 ]]; then
  echo 'Usage: build_windows.sh WORK_DIRECTORY EMPTY_OUTPUT_DIRECTORY' >&2
  exit 2
fi
WORK=$(realpath -m -- "$1")
OUT=$(realpath -m -- "$2")
[[ ! -e "$WORK" && ! -e "$OUT" ]] || { echo 'Choose new, task-owned build/output directories' >&2; exit 2; }
mkdir -p "$WORK" "$OUT/build-info" "$OUT/licenses" "$OUT/sources" "$OUT/recipe"
RECIPE_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
JOBS=${MEDIA_ENGINE_JOBS:-$(nproc)}
exec > >(tee "$OUT/build-info/build.log") 2>&1
trap 'code=$?; printf "{\"exit_code\":%s,\"complete_format_acceptance\":false}\n" "$code" > "$OUT/build-info/build-status.json"; exit "$code"' EXIT
python3 "$ROOT/tools/media_engine/fetch_sources.py" --downloads "$OUT/sources" --extract "$WORK/source"
cp "$ROOT/tools/media_engine/"* "$OUT/recipe/"
cp "$ROOT/.github/workflows/build-media-engine-windows.yml" "$OUT/recipe/"
cp "$ROOT/docs/media-engine-build.md" "$OUT/recipe/"
dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' > "$OUT/build-info/ubuntu-packages.tsv"
x86_64-w64-mingw32-gcc --version > "$OUT/build-info/compiler-version.txt"
nasm -v > "$OUT/build-info/nasm-version.txt"
meson --version > "$OUT/build-info/meson-version.txt"
printf '%s\n' "${ImageOS:-unknown} ${ImageVersion:-unknown}" > "$OUT/build-info/runner-image.txt"
export GNUPGHOME="$WORK/gnupg"
mkdir -m 700 "$GNUPGHOME"
FINGERPRINT=$(gpg --batch --show-keys --with-colons "$OUT/sources/ffmpeg-devel.asc" | awk -F: '$1=="fpr" {print $10;exit}')
[[ "$FINGERPRINT" == FCF986EA15E6E293A5644F10B4322F04D67658D8 ]]
gpg --batch --import "$OUT/sources/ffmpeg-devel.asc"
gpg --batch --status-fd 1 --verify "$OUT/sources/ffmpeg-9.0.2.tar.xz.asc" "$OUT/sources/ffmpeg-9.0.2.tar.xz" 2>&1 | tee "$OUT/build-info/ffmpeg-signature-verification.txt"

# The release tarball and the full, immutable official Git commit must contain
# the same tracked source bytes (only Git metadata and generated VERSION differ).
git init -q "$WORK/ffmpeg-commit"
git -C "$WORK/ffmpeg-commit" fetch --depth 1 https://github.com/FFmpeg/FFmpeg.git 946fcce07b6dcd0331c8cc609192aeff5e1924f8
git -C "$WORK/ffmpeg-commit" checkout --detach FETCH_HEAD
git ls-remote https://github.com/FFmpeg/FFmpeg.git 'refs/tags/n9.0.2^{}' | tee "$OUT/build-info/ffmpeg-tag-resolution.txt"
grep -q '^946fcce07b6dcd0331c8cc609192aeff5e1924f8' "$OUT/build-info/ffmpeg-tag-resolution.txt"
python3 - "$WORK" "$OUT" <<'PY'
from pathlib import Path
import hashlib,json,subprocess,sys
work,out=map(Path,sys.argv[1:]); repo=work/'ffmpeg-commit'; release=work/'source/ffmpeg-9.0.2'
files=subprocess.check_output(['git','ls-files'],cwd=repo,text=True).splitlines()
different=[]
for name in files:
    if name.startswith('.git') or name=='VERSION':continue
    a,b=repo/name,release/name
    if not b.is_file() or a.read_bytes()!=b.read_bytes():different.append(name)
report={'source_commit':'946fcce07b6dcd0331c8cc609192aeff5e1924f8','checked_files':len(files),'different':different}
(out/'build-info/ffmpeg-source-identity.json').write_text(json.dumps(report,indent=2)+'\n')
if different:raise SystemExit('release/Git source differences: '+repr(different))
PY

PREFIX="$WORK/prefix"
export SOURCE_DATE_EPOCH=1789689600
export GIT_DIR=/dev/null
export CC=x86_64-w64-mingw32-gcc
export AR=x86_64-w64-mingw32-ar
export RANLIB=x86_64-w64-mingw32-ranlib
export STRIP=x86_64-w64-mingw32-strip
export CFLAGS='-O2 -ffunction-sections -fdata-sections'
export LDFLAGS='-static -static-libgcc -Wl,--gc-sections'
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
cd "$WORK/source/zlib-1.3.2"
CHOST=x86_64-w64-mingw32 ./configure --static --prefix="$PREFIX"
make -j "$JOBS"
make install
cat > "$WORK/mingw-cross.ini" <<EOF
[binaries]
c = 'x86_64-w64-mingw32-gcc'
cpp = 'x86_64-w64-mingw32-g++'
ar = 'x86_64-w64-mingw32-ar'
strip = 'x86_64-w64-mingw32-strip'
windres = 'x86_64-w64-mingw32-windres'
pkg-config = 'pkg-config'
[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
[properties]
needs_exe_wrapper = true
[built-in options]
c_link_args = ['-static', '-static-libgcc']
EOF
meson setup "$WORK/dav1d-build" "$WORK/source/dav1d-1.5.4" --cross-file "$WORK/mingw-cross.ini" \
  --prefix="$PREFIX" --default-library=static --buildtype=release --wrap-mode=nodownload \
  -Denable_tools=false -Denable_tests=false -Denable_examples=false -Dxxhash_muxer=disabled
meson compile -C "$WORK/dav1d-build" -j "$JOBS"
meson install -C "$WORK/dav1d-build"

mkdir "$WORK/ffmpeg-build"
cd "$WORK/ffmpeg-build"
CONFIGURE=(--target-os=mingw32 --arch=x86_64 --cross-prefix=x86_64-w64-mingw32- --enable-cross-compile
  --disable-autodetect --disable-gpl --disable-version3 --disable-nonfree --disable-network
  --disable-shared --enable-static --disable-debug --disable-doc --disable-ffplay --disable-avdevice
  --disable-devices --disable-protocols --enable-protocol=file,pipe --enable-w32threads --disable-pthreads
  --enable-mediafoundation --enable-encoder=h264_mf --enable-libdav1d --enable-zlib
  --pkg-config=pkg-config --pkg-config-flags=--static
  --extra-cflags="-I$PREFIX/include -O2 -ffunction-sections -fdata-sections"
  --extra-ldflags="-L$PREFIX/lib -static -static-libgcc -Wl,--gc-sections")
python3 - "$OUT/build-info/configure.json" "${CONFIGURE[@]}" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps(sys.argv[2:],indent=2)+'\n')
PY
"$WORK/source/ffmpeg-9.0.2/configure" "${CONFIGURE[@]}"
cp config.h config_components.h "$OUT/build-info/"
cp ffbuild/config.mak ffbuild/config.log "$OUT/build-info/"
python3 - "$ROOT" <<'PY'
from pathlib import Path
import sys
sys.path.insert(0,sys.argv[1])
from tools.media_engine.engine_manifest import validate_configuration
validate_configuration(Path('config.h').read_text()+'\n'+Path('config_components.h').read_text())
PY
make -j "$JOBS" ffmpeg.exe ffprobe.exe
cp ffmpeg.exe ffprobe.exe "$OUT/"
cp "$WORK/source/ffmpeg-9.0.2/COPYING.LGPLv2.1" "$OUT/licenses/FFmpeg-LGPL-2.1.txt"
cp "$WORK/source/ffmpeg-9.0.2/LICENSE.md" "$OUT/licenses/FFmpeg-LICENSE.md"
cp "$WORK/source/dav1d-1.5.4/COPYING" "$OUT/licenses/dav1d-BSD-2-Clause.txt"
cp "$WORK/source/zlib-1.3.2/LICENSE" "$OUT/licenses/zlib-LICENSE.txt"
for package in mingw-w64-common gcc-mingw-w64-base gcc-mingw-w64-x86-64-posix; do
  if [[ -f "/usr/share/doc/$package/copyright" ]]; then
    cp -L "/usr/share/doc/$package/copyright" "$OUT/licenses/$package-copyright.txt"
  fi
done
printf 'FFmpeg, dav1d and zlib release source archives are unmodified.\n' > "$OUT/sources/changes.txt"
cp "$WORK/mingw-cross.ini" "$OUT/build-info/"
python3 "$ROOT/tools/media_engine/engine_manifest.py" --stage "$OUT" --build "$WORK/ffmpeg-build" --recipe-commit "$RECIPE_COMMIT"
