#!/bin/sh
# Build the raylib bindings and the demo.
#   tools/gen_bindings.ts  — parses raylib.h, regenerates gen/
#   gen/raylib_shim.c      — C wrappers, compiled into gen/libraylib_shim.a
#   demo/main.ts           — scriptc build against gen/raylib_ffi.json
set -e
cd "$(dirname "$0")"

RAYLIB_H="${RAYLIB_H:-$(pkg-config --variable=includedir raylib 2>/dev/null)/raylib.h}"
[ -f "$RAYLIB_H" ] || RAYLIB_H=/opt/homebrew/include/raylib.h
[ -f "$RAYLIB_H" ] || RAYLIB_H="$(dirname "$0")/assets/include/raylib.h"
echo "== header: $RAYLIB_H"

bun tools/gen_bindings.ts "$RAYLIB_H" gen

echo "== shim"
cc -O2 -c gen/raylib_shim.c -o gen/raylib_shim.o $(pkg-config --cflags raylib)
ar rcs gen/libraylib_shim.a gen/raylib_shim.o

echo "== scriptc"
# Homebrew's lib dir is not in the default linker search path.
LIBRARY_PATH="$(pkg-config --variable=libdir raylib)" scriptc build demo/main.ts --ffi gen/raylib_ffi.json -o demo/demo

echo "== done: demo/demo"
