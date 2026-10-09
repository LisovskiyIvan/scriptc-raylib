#!/usr/bin/env node
/**
 * createshim — compile raylib C shim into gen/libraylib_shim.a for @dayme/scriptc-raylib.
 *
 * Usage:
 *   npx createshim          compile gen/raylib_shim.c -> gen/libraylib_shim.a
 *   npx createshim paths    print where raylib was found
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findRaylibHeader, findRaylibLibrary, findRaylibLinkDir } from "./resolve_raylib.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`createshim: ${message}`);
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
  const isWindows = process.platform === "win32";
  const cc = process.env.CC ?? (isWindows ? "gcc" : "cc");
  const ar = process.env.AR ?? (isWindows ? "ar" : "ar");

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
    shell: isWindows,
  });
  if (compile.status !== 0) {
    fail("compiling gen/raylib_shim.c failed");
  }

  const archive = spawnSync(ar, ["rcs", archivePath, objectPath], {
    stdio: "inherit",
    shell: isWindows,
  });
  if (archive.status !== 0) {
    fail("creating gen/libraylib_shim.a failed");
  }

  const manifest = join(pkgRoot, "gen", "raylib_ffi.json");
  const linkDir = findRaylibLinkDir();
  const env = linkDir ? `LIBRARY_PATH=${linkDir} ` : "";

  console.log(`\nshim:     ${archivePath}`);
  console.log(`manifest: ${manifest}`);
  if (existsSync(manifest)) {
    const parsed = JSON.parse(readFileSync(manifest, "utf-8"));
    console.log(`functions: ${parsed.functions?.length ?? 0} (ffi_format ${parsed.ffi_format})`);
  }
  const consumerDir = process.cwd();
  if (resolve(consumerDir) !== resolve(pkgRoot)) {
    const linkTarget = join(consumerDir, "raylib");
    if (!existsSync(linkTarget)) {
      try {
        const isWindows = process.platform === "win32";
        if (isWindows) {
          // On Windows, NTFS junctions do not require administrator privileges or Developer Mode
          symlinkSync(resolve(pkgRoot), linkTarget, "junction");
        } else {
          const relPkg = relative(consumerDir, pkgRoot);
          symlinkSync(relPkg, linkTarget, "dir");
        }
        console.log(`linked:   ./raylib -> ${pkgRoot}`);
      } catch {
        try {
          // Fallback if links/junctions are not supported on filesystem: copy folder
          cpSync(pkgRoot, linkTarget, { recursive: true });
          console.log(`copied:   ./raylib -> ${pkgRoot} (symlinks not supported on drive)`);
        } catch {
          // ignore
        }
      }
    }

    const tsconfigPath = join(consumerDir, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      try {
        const raw = readFileSync(tsconfigPath, "utf-8");
        const clean = raw.replace(/\/\/.*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        const tsconfig = JSON.parse(clean);
        tsconfig.compilerOptions = tsconfig.compilerOptions || {};
        const paths = tsconfig.compilerOptions.paths || {};
        if (!paths["@dayme/scriptc-raylib"]) {
          paths["@dayme/scriptc-raylib"] = ["./raylib/src/index.ts"];
          tsconfig.compilerOptions.paths = paths;
          writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
          console.log("tsconfig: added path mapping for @dayme/scriptc-raylib (enables 100% static compilation)");
        }
      } catch {}
    }
  }

  const displayManifest = resolve(consumerDir) !== resolve(pkgRoot) ? relative(consumerDir, manifest) : manifest;

  console.log("\nRun your game:");
  console.log(`  ${env}scriptc run src/main.ts --ffi ${displayManifest}`);
  console.log("\nBuild your game:");
  console.log(`  ${env}scriptc build src/main.ts --ffi ${displayManifest} -o game`);
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "paths":
    cmdPaths();
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(
      [
        "createshim — compile raylib native shim for @dayme/scriptc-raylib",
        "",
        "Usage:",
        "  npx createshim          compile gen/raylib_shim.c into gen/libraylib_shim.a",
        "  npx createshim paths    show where raylib headers and libraries were found",
        "",
      ].join("\n"),
    );
    break;
  case "shim":
  case undefined:
  case "":
    cmdShim();
    break;
  default:
    fail(`unknown argument: ${command} (try: paths, help)`);
    void rest;
}
