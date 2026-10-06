#!/bin/sh
# Build the raylib bindings and the demo.
#   tools/gen_bindings.ts  — parses raylib.h, regenerates gen/
#   gen/raylib_shim.c      — C wrappers, compiled into gen/libraylib_shim.a
#   demo/main.ts           — scriptc build against gen/raylib_ffi.json
set -e
cd "$(dirname "$0")"

# 1. Header discovery: env -> pkg-config -> system paths -> local assets
find_header() {
  if [ -n "$RAYLIB_H" ] && [ -f "$RAYLIB_H" ]; then
    echo "$RAYLIB_H"
    return
  fi
  if command -v pkg-config >/dev/null 2>&1; then
    PC_INC="$(pkg-config --variable=includedir raylib 2>/dev/null)"
    if [ -n "$PC_INC" ] && [ -f "$PC_INC/raylib.h" ]; then
      echo "$PC_INC/raylib.h"
      return
    fi
  fi
  for p in \
    "/opt/homebrew/include/raylib.h" \
    "/usr/local/include/raylib.h" \
    "/usr/include/raylib.h" \
    "/usr/include/x86_64-linux-gnu/raylib.h" \
    "/usr/include/aarch64-linux-gnu/raylib.h" \
    "$(dirname "$0")/assets/include/raylib.h"
  do
    if [ -f "$p" ]; then
      echo "$p"
      return
    fi
  done
}

RAYLIB_H="$(find_header)"
echo "== header: $RAYLIB_H"

bun tools/gen_bindings.ts "$RAYLIB_H" gen

echo "== shim"
CFLAGS=""
if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists raylib 2>/dev/null; then
  CFLAGS="$(pkg-config --cflags raylib)"
else
  CFLAGS="-I$(dirname "$RAYLIB_H")"
fi

cc -O2 -c gen/raylib_shim.c -o gen/raylib_shim.o $CFLAGS
ar rcs gen/libraylib_shim.a gen/raylib_shim.o

echo "== scriptc"
# Search library path for the native linker (macOS, Linux)
if [ -z "$LIBRARY_PATH" ]; then
  if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists raylib 2>/dev/null; then
    LIBRARY_PATH="$(pkg-config --variable=libdir raylib)"
  elif [ -d "/opt/homebrew/lib" ]; then
    LIBRARY_PATH="/opt/homebrew/lib"
  elif [ -d "/usr/local/lib" ]; then
    LIBRARY_PATH="/usr/local/lib"
  elif [ -d "/usr/lib/x86_64-linux-gnu" ]; then
    LIBRARY_PATH="/usr/lib/x86_64-linux-gnu"
  elif [ -d "/usr/lib/aarch64-linux-gnu" ]; then
    LIBRARY_PATH="/usr/lib/aarch64-linux-gnu"
  elif [ -d "./assets/lib" ]; then
    LIBRARY_PATH="$(pwd)/assets/lib"
  fi
fi

LIBRARY_PATH="$LIBRARY_PATH" scriptc build demo/main.ts --ffi gen/raylib_ffi.json -o demo/demo

echo "== done: demo/demo"
