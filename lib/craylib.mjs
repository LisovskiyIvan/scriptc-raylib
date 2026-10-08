#!/usr/bin/env node
/**
 * craylib — build the FFI shim and report the resolved raylib locations.
 *
 * The published package cannot ship a prebuilt `libraylib_shim.a`: it has to
 * match the consumer's architecture, compiler ABI and raylib version. Instead
 * the C source ships in `gen/` and this CLI compiles it in place, next to the
 * manifest that references it.
 *
 *   npx craylib shim      compile gen/raylib_shim.c -> gen/libraylib_shim.a
 *   npx craylib paths     print where raylib was found
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findRaylibHeader, findRaylibLibrary, findRaylibLinkDir } from "./resolve_raylib.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`craylib: ${message}`);
  process.exit(1);
}

function cmdPaths() {
  const header = findRaylibHeader();
  const library = findRaylibLibrary();
  const linkDir = findRaylibLinkDir();

  console.log(`header:     ${header ?? "(not found)"}`);
  console.log(`library:    ${library ?? "(not found)"}`);
  console.log(`link dir:   ${linkDir ?? "(not found)"}`);

  if (!library) {
    console.error("");
    console.error("Install raylib first, for example:");
    console.error("  macOS:   brew install raylib");
    console.error("  Debian:  sudo apt install libraylib-dev");
    console.error("  Arch:    sudo pacman -S raylib");
    console.error("  Fedora:  sudo dnf install raylib-devel");
    console.error("  Windows: vcpkg install raylib:x64-windows");
    console.error("Or set RAYLIB_LIB / RAYLIB_PATH / LIBRARY_PATH.");
    process.exit(1);
  }
}

function cmdShim() {
  const header = findRaylibHeader();
  if (!header) {
    fail("raylib.h not found. Install raylib or set RAYLIB_H / RAYLIB_PATH.");
  }

  const shimSource = join(pkgRoot, "gen", "raylib_shim.c");
  if (!existsSync(shimSource)) {
    fail(`missing ${shimSource}`);
  }

  const objectPath = join(pkgRoot, "gen", "raylib_shim.o");
  const archivePath = join(pkgRoot, "gen", "libraylib_shim.a");
  const cc = process.env.CC ?? "cc";
  const ar = process.env.AR ?? "ar";

  console.log(`header:   ${header}`);
  console.log(`compiler: ${cc}`);

  let cflags = `-I"${dirname(header)}"`;
  try {
    const pc = spawnSync("pkg-config", ["--cflags", "raylib"], { encoding: "utf-8" }).stdout?.trim();
    if (pc) cflags = pc;
  } catch {
    // pkg-config is optional; the include path above is enough.
  }

  const compile = spawnSync(cc, ["-O2", "-c", shimSource, "-o", objectPath, cflags], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (compile.status !== 0) {
    fail("compiling gen/raylib_shim.c failed");
  }

  const archive = spawnSync(ar, ["rcs", archivePath, objectPath], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (archive.status !== 0) {
    fail("creating gen/libraylib_shim.a failed");
  }

  // Report the manifest next to it so a build command can be pasted directly.
  const manifest = join(pkgRoot, "gen", "raylib_ffi.json");
  const linkDir = findRaylibLinkDir();
  const env = linkDir ? `LIBRARY_PATH=${linkDir} ` : "";

  console.log(`\nshim:     ${archivePath}`);
  console.log(`manifest: ${manifest}`);
  if (existsSync(manifest)) {
    const parsed = JSON.parse(readFileSync(manifest, "utf-8"));
    console.log(`functions: ${parsed.functions?.length ?? 0} (ffi_format ${parsed.ffi_format})`);
  }
  console.log("\nbuild your game with:");
  console.log(`  ${env}scriptc build src/main.ts --ffi gen/raylib_ffi.json -o game`);
}

const [command = "help", ...rest] = process.argv.slice(2);

switch (command) {
  case "shim":
    cmdShim();
    break;
  case "paths":
    cmdPaths();
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(
      [
        "craylib — typed raylib bindings for scriptc",
        "",
        "Usage:",
        "  craylib shim     compile gen/raylib_shim.c into gen/libraylib_shim.a",
        "  craylib paths    show where raylib headers and libraries were found",
        "",
      ].join("\n"),
    );
    break;
  default:
    fail(`unknown command: ${command} (try: shim, paths)`);
    void rest;
}