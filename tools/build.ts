#!/usr/bin/env bun
/**
 * Cross-platform build script for craylib (Linux, macOS, Windows).
 * Usage: bun tools/build.ts [path/to/raylib.h]
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { findRaylibHeader, findRaylibLibrary } from "../src/config";

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
console.log("== scriptc");
const outName = isWindows ? "demo/demo.exe" : "demo/demo";
const libPath = findRaylibLibrary();

const env = { ...process.env };
if (libPath && !env.LIBRARY_PATH) {
  env.LIBRARY_PATH = dirname(libPath);
}

execSync(`scriptc build demo/main.ts --ffi gen/raylib_ffi.json -o ${outName}`, {
  stdio: "inherit",
  env,
});

console.log(`== done: ${outName}`);
