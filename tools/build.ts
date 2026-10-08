#!/usr/bin/env bun
/**
 * Cross-platform build script for craylib (Linux, macOS, Windows).
 * Usage: bun tools/build.ts [path/to/raylib.h]
 */

import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { findRaylibHeader, findRaylibLinkDir } from "./resolve_raylib";

const header = findRaylibHeader(process.argv[2]);
if (!header) {
  console.error("Error: raylib.h not found on this system.");
  console.error("Please install raylib, or set RAYLIB_H / RAYLIB_PATH, or pass the path as an argument.");
  process.exit(1);
}

console.log(`== header: ${header}`);

// 1. Generate bindings
execSync(`bun tools/gen_bindings.ts "${header}" gen`, { stdio: "inherit" });

// 2. Compile C shim
console.log("== shim");
let cflags = `-I"${dirname(header)}"`;
try {
  const pc = execSync("pkg-config --cflags raylib 2>/dev/null", { encoding: "utf-8" }).trim();
  if (pc) cflags = pc;
} catch {}

const isWindows = process.platform === "win32";
const cc = process.env.CC ?? (isWindows ? "gcc" : "cc");
const ar = process.env.AR ?? (isWindows ? "ar" : "ar");

execSync(`${cc} -O2 -c gen/raylib_shim.c -o gen/raylib_shim.o ${cflags}`, { stdio: "inherit" });
execSync(`${ar} rcs gen/libraylib_shim.a gen/raylib_shim.o`, { stdio: "inherit" });

// 3. Scriptc build
// The manifest links raylib as a system library, so its directory is supplied
// here through LIBRARY_PATH instead of being baked into the manifest.
console.log("== scriptc");
const outName = isWindows ? "demo/demo.exe" : "demo/demo";

const env = { ...process.env };
if (!env.LIBRARY_PATH) {
  const linkDir = findRaylibLinkDir();
  if (!linkDir) {
    console.error("Error: raylib library not found.");
    console.error("Install raylib, or set LIBRARY_PATH=/path/to/raylib/lib.");
    process.exit(1);
  }
  env.LIBRARY_PATH = linkDir;
  console.log(`== library path: ${env.LIBRARY_PATH}`);
}

execSync(`scriptc build demo/main.ts --ffi gen/raylib_ffi.json -o ${outName}`, {
  stdio: "inherit",
  env,
});

console.log(`== done: ${outName}`);
