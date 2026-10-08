/**
 * Build-time raylib discovery.
 *
 * Plain ESM with no build step, so it runs under Node.js and Bun alike and can
 * be imported from TypeScript tooling as well as the published CLI.
 *
 * Kept out of `src/` on purpose: `src/config.ts` is compiled into every game
 * binary, and importing `node:fs` or `node:child_process` there would pull the
 * Node.js filesystem and process shims into the executable.
 *
 * Discovery order for both the header and the library:
 *   1. explicit argument
 *   2. RAYLIB_LIB / RAYLIB_H / RAYLIB_PATH environment variables
 *   3. pkg-config
 *   4. well-known system locations per platform
 *   5. bundled assets/include/raylib.h (header only)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Shared with tools/gen_bindings.ts, which runs before any build script. */
const SYSTEM_LIB_CANDIDATES = [
  // macOS (Homebrew ARM/Intel, MacPorts)
  "/opt/homebrew/lib/libraylib.dylib",
  "/usr/local/lib/libraylib.dylib",
  "/opt/local/lib/libraylib.dylib",
  // Linux (Debian, Ubuntu, Arch, Fedora)
  "/usr/lib/libraylib.so",
  "/usr/lib64/libraylib.so",
  "/usr/local/lib/libraylib.so",
  "/usr/lib/x86_64-linux-gnu/libraylib.so",
  "/usr/lib/aarch64-linux-gnu/libraylib.so",
  // Windows (raylib installer, w64devkit, MSYS2, vcpkg)
  "C:/raylib/raylib/src/raylib.dll",
  "C:/raylib/w64devkit/x86_64-w64-mingw32/lib/libraylib.a",
  "C:/msys64/mingw64/bin/raylib.dll",
  "C:/msys64/mingw64/lib/libraylib.a",
  "C:/msys64/ucrt64/bin/raylib.dll",
  "C:/msys64/ucrt64/lib/libraylib.a",
  "C:/msys64/clang64/bin/raylib.dll",
  "C:/vcpkg/installed/x64-windows/bin/raylib.dll",
  "C:/vcpkg/installed/x64-windows/lib/raylib.lib",
  "C:/Program Files/raylib/lib/raylib.dll",
  "C:/Program Files (x86)/raylib/lib/raylib.dll",
];

const HEADER_CANDIDATES = [
  // macOS
  "/opt/homebrew/include/raylib.h",
  "/usr/local/include/raylib.h",
  "/opt/local/include/raylib.h",
  // Linux
  "/usr/include/raylib.h",
  "/usr/local/include/raylib.h",
  "/usr/include/x86_64-linux-gnu/raylib.h",
  "/usr/include/aarch64-linux-gnu/raylib.h",
  // Windows
  "C:/raylib/raylib/src/raylib.h",
  "C:/raylib/w64devkit/x86_64-w64-mingw32/include/raylib.h",
  "C:/msys64/mingw64/include/raylib.h",
  "C:/msys64/ucrt64/include/raylib.h",
  "C:/msys64/clang64/include/raylib.h",
  "C:/vcpkg/installed/x64-windows/include/raylib.h",
  "C:/Program Files/raylib/include/raylib.h",
];

const LIB_NAMES = ["libraylib.dylib", "libraylib.so", "libraylib.a", "raylib.lib", "raylib.dll"];

function pkgConfig(variable) {
  try {
    const out = execSync(`pkg-config --variable=${variable} raylib 2>/dev/null`, {
      encoding: "utf-8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Locates the raylib shared/static library file, or null when absent. */
export function findRaylibLibrary(explicit) {
  if (explicit && existsSync(explicit)) return explicit;

  if (process.env.RAYLIB_LIB && existsSync(process.env.RAYLIB_LIB)) {
    return process.env.RAYLIB_LIB;
  }

  if (process.env.RAYLIB_PATH) {
    for (const sub of [
      "lib/libraylib.dylib", "lib/libraylib.so", "lib/raylib.dll", "lib/raylib.lib",
      "src/libraylib.dylib", "src/libraylib.so", "src/raylib.dll",
      "libraylib.dylib", "libraylib.so", "raylib.dll",
    ]) {
      const p = join(process.env.RAYLIB_PATH, sub);
      if (existsSync(p)) return p;
    }
  }

  const pcLibDir = pkgConfig("libdir");
  if (pcLibDir) {
    for (const name of LIB_NAMES) {
      const p = join(pcLibDir, name);
      if (existsSync(p)) return p;
    }
  }

  // No bundled library fallback on purpose: a prebuilt raylib would pin one
  // version and architecture, and 6.0 bindings fail to link against 5.5. Only
  // assets/include/raylib.h is bundled, so bindings can be regenerated.
  const candidates = [...SYSTEM_LIB_CANDIDATES];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return null;
}

/** Locates raylib.h, or null when absent. */
export function findRaylibHeader(explicit) {
  if (explicit && existsSync(explicit)) return explicit;

  if (process.env.RAYLIB_H && existsSync(process.env.RAYLIB_H)) {
    return process.env.RAYLIB_H;
  }

  if (process.env.RAYLIB_PATH) {
    for (const sub of ["include/raylib.h", "src/raylib.h", "raylib.h"]) {
      const p = join(process.env.RAYLIB_PATH, sub);
      if (existsSync(p)) return p;
    }
  }

  const pcIncDir = pkgConfig("includedir");
  if (pcIncDir && existsSync(join(pcIncDir, "raylib.h"))) {
    return join(pcIncDir, "raylib.h");
  }

  const candidates = [
    ...HEADER_CANDIDATES,
    // Bundled with the repository so bindings can be regenerated on a machine
    // that has the library but not its headers.
    resolve("assets/include/raylib.h"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return null;
}

/**
 * Directory the native linker should search for raylib.
 * Prefers an explicit LIBRARY_PATH so callers keep control of the link line.
 */
export function findRaylibLinkDir() {
  if (process.env.LIBRARY_PATH) return process.env.LIBRARY_PATH;

  const pcLibDir = pkgConfig("libdir");
  if (pcLibDir && existsSync(pcLibDir)) return pcLibDir;

  const lib = findRaylibLibrary();
  return lib ? dirname(lib) : null;
}