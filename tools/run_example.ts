#!/usr/bin/env bun
/**
 * Run a craylib example using scriptc with the FFI manifest automatically linked.
 *
 * Usage:
 *   bun run example index
 *   bun run example shapes
 *   bun tools/run_example.ts examples/index.ts
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRaylibLinkDir } from "./resolve_raylib";

const rootDir = resolve(import.meta.dir, "..");
const ffiManifest = join(rootDir, "gen/raylib_ffi.json");
const shimLib = join(rootDir, "gen/libraylib_shim.a");

// The manifest links raylib as a system library, so the linker needs its
// directory at run time too — not only at shim build time.
const linkDir = findRaylibLinkDir();
if (!linkDir) {
  console.error("Error: raylib library not found.");
  console.error("Install raylib, or set LIBRARY_PATH=/path/to/raylib/lib.");
  process.exit(1);
}

if (!existsSync(shimLib) || !existsSync(ffiManifest)) {
  console.log("== Building shim library first...");
  const buildRes = spawnSync("bun", [join(rootDir, "tools/build.ts")], { stdio: "inherit", cwd: rootDir });
  if (buildRes.status !== 0) {
    process.exit(buildRes.status ?? 1);
  }
}

let arg = process.argv[2] ?? "index";
if (!arg.endsWith(".ts")) {
  arg = arg.endsWith(".js") ? arg : `${arg}.ts`;
}

const examplePath = arg.startsWith("examples/") ? join(rootDir, arg) : join(rootDir, "examples", arg);

if (!existsSync(examplePath)) {
  console.error(`Error: example not found at ${examplePath}`);
  console.error("Available examples in examples/:");
  const files = readdirSync(join(rootDir, "examples")).filter((f) => f.endsWith(".ts")).sort();
  for (const f of files) console.error(`  - ${f.replace(/\.ts$/, "")}`);
  process.exit(1);
}

console.log(`== Running ${arg} with scriptc --ffi gen/raylib_ffi.json ...`);
const child = spawnSync("scriptc", ["run", examplePath, "--ffi", ffiManifest], {
  stdio: "inherit",
  cwd: rootDir,
  env: { ...process.env, LIBRARY_PATH: linkDir },
});

process.exit(child.status ?? 0);
