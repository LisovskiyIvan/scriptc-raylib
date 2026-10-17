/**
 * Build-time raylib discovery.
 *
 * Plain ESM with no build step, so it runs under Node.js and Bun alike and can
 * be imported from TypeScript tooling as well as the published CLI.
 *
 * Kept out of `src/` on purpose: `src/` is compiled into every game
 * binary, and importing `node:fs` or `node:child_process` there would pull the
 * Node.js filesystem and process shims into the executable.
 *
 * Discovery order for both the header and the library:
 *   1. explicit argument (CLI or function argument)
 *   2. project config file: `raylib.json` in consumer project root
 *   3. RAYLIB_LIB / RAYLIB_H / RAYLIB_PATH environment variables
 *   4. pkg-config
 *   5. well-known system locations per platform
 *   6. bundled assets/include/raylib.h (header only)
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

/**
 * Searches for a raylib project configuration file (`raylib.json`).
 * Walks upward from `startDir` until the root or project root is reached.
 */
export function findProjectConfig(startDir = ((process.env.npm_lifecycle_event === "postinstall" && process.env.INIT_CWD) ? process.env.INIT_CWD : process.cwd())) {
  let cur = resolve(startDir);
  while (true) {
    const raylibJson = join(cur, "raylib.json");
    if (existsSync(raylibJson)) {
      try {
        const raw = JSON.parse(readFileSync(raylibJson, "utf-8"));
        const cfg = typeof raw === "string" ? { path: raw } : (raw && typeof raw === "object" ? raw : {});
        return {
          source: raylibJson,
          dir: cur,
          path: cfg.path ?? cfg.raylib,
          lib: cfg.lib,
          header: cfg.header,
        };
      } catch (err) {
        console.warn(`warning: failed to parse ${raylibJson}: ${err.message}`);
      }
    }

    const parent = dirname(cur);
    if (parent === cur) break;
    // Don't search beyond git root or node_modules boundary
    if (existsSync(join(cur, ".git")) || existsSync(join(cur, "node_modules"))) {
      break;
    }
    cur = parent;
  }
  return null;
}

/** Locates the raylib shared/static library file, or null when absent. */
export function findRaylibLibrary(explicit) {
  if (explicit && existsSync(explicit)) return resolve(explicit);

  // 1. Project config (raylib.json)
  const cfg = findProjectConfig();
  if (cfg) {
    if (cfg.lib) {
      const p = resolve(cfg.dir, cfg.lib);
      if (existsSync(p)) return p;
    }
    if (cfg.path) {
      const base = resolve(cfg.dir, cfg.path);
      if (existsSync(base) && LIB_NAMES.some((n) => base.endsWith(n))) {
        return base;
      }
      for (const sub of [
        "lib/libraylib.dylib", "lib/libraylib.so", "lib/raylib.dll", "lib/raylib.lib", "lib/libraylib.a",
        "src/libraylib.dylib", "src/libraylib.so", "src/raylib.dll", "src/libraylib.a",
        "libraylib.dylib", "libraylib.so", "raylib.dll", "raylib.lib", "libraylib.a",
        "bin/raylib.dll",
      ]) {
        const p = join(base, sub);
        if (existsSync(p)) return p;
      }
    }
  }

  // 2. Environment variables
  if (process.env.RAYLIB_LIB && existsSync(process.env.RAYLIB_LIB)) {
    return resolve(process.env.RAYLIB_LIB);
  }

  if (process.env.RAYLIB_PATH) {
    for (const sub of [
      "lib/libraylib.dylib", "lib/libraylib.so", "lib/raylib.dll", "lib/raylib.lib", "lib/libraylib.a",
      "src/libraylib.dylib", "src/libraylib.so", "src/raylib.dll", "src/libraylib.a",
      "libraylib.dylib", "libraylib.so", "raylib.dll", "raylib.lib", "libraylib.a",
      "bin/raylib.dll",
    ]) {
      const p = join(process.env.RAYLIB_PATH, sub);
      if (existsSync(p)) return p;
    }
  }

  // 3. pkg-config
  const pcLibDir = pkgConfig("libdir");
  if (pcLibDir) {
    for (const name of LIB_NAMES) {
      const p = join(pcLibDir, name);
      if (existsSync(p)) return p;
    }
  }

  // 4. Well-known system locations
  const candidates = [...SYSTEM_LIB_CANDIDATES];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return null;
}

/** Locates raylib.h, or null when absent. */
export function findRaylibHeader(explicit) {
  if (explicit && existsSync(explicit)) return resolve(explicit);

  // 1. Project config (raylib.json)
  const cfg = findProjectConfig();
  if (cfg) {
    if (cfg.header) {
      const p = resolve(cfg.dir, cfg.header);
      if (existsSync(p)) return p;
    }
    if (cfg.path) {
      const base = resolve(cfg.dir, cfg.path);
      if (existsSync(base) && base.endsWith("raylib.h")) {
        return base;
      }
      for (const sub of ["include/raylib.h", "src/raylib.h", "raylib.h"]) {
        const p = join(base, sub);
        if (existsSync(p)) return p;
      }
    }
  }

  // 2. Environment variables
  if (process.env.RAYLIB_H && existsSync(process.env.RAYLIB_H)) {
    return resolve(process.env.RAYLIB_H);
  }

  if (process.env.RAYLIB_PATH) {
    for (const sub of ["include/raylib.h", "src/raylib.h", "raylib.h"]) {
      const p = join(process.env.RAYLIB_PATH, sub);
      if (existsSync(p)) return p;
    }
  }

  // 3. pkg-config
  const pcIncDir = pkgConfig("includedir");
  if (pcIncDir && existsSync(join(pcIncDir, "raylib.h"))) {
    return join(pcIncDir, "raylib.h");
  }

  // 4. Well-known system locations & bundled header
  const candidates = [
    ...HEADER_CANDIDATES,
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
  const cfg = findProjectConfig();
  if (cfg?.lib) {
    const p = resolve(cfg.dir, cfg.lib);
    if (existsSync(p)) return dirname(p);
  }

  if (process.env.LIBRARY_PATH) return process.env.LIBRARY_PATH;

  const pcLibDir = pkgConfig("libdir");
  if (pcLibDir && existsSync(pcLibDir)) return pcLibDir;

  const lib = findRaylibLibrary();
  return lib ? dirname(lib) : null;
}