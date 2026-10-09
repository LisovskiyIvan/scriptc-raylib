import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";

export interface RaylibConfig {
  /**
   * Path to the raylib library (.dylib, .so, .dll, .lib) or directory.
   * Can be set to "auto" to automatically discover raylib on the current operating system.
   */
  raylibPath?: string;

  /**
   * Path to raylib headers directory or raylib.h file.
   */
  headerPath?: string;

  /**
   * Path to raylib_ffi.json manifest.
   */
  manifestPath?: string;

  /**
   * Detected or resolved raylib library path.
   */
  resolvedRaylibPath?: string;

  /**
   * Detected or resolved raylib header path.
   */
  resolvedHeaderPath?: string;

  /**
   * Directory the native linker should search for raylib.
   */
  linkDir?: string;
}

export const SYSTEM_LIB_CANDIDATES: readonly string[] = [
  // macOS (Homebrew ARM/Intel, MacPorts)
  "/opt/homebrew/lib/libraylib.dylib",
  "/usr/local/lib/libraylib.dylib",
  "/opt/local/lib/libraylib.dylib",
  // Linux (Debian, Ubuntu, Arch, Fedora, openSUSE)
  "/usr/lib/libraylib.so",
  "/usr/lib64/libraylib.so",
  "/usr/local/lib/libraylib.so",
  "/usr/lib/x86_64-linux-gnu/libraylib.so",
  "/usr/lib/aarch64-linux-gnu/libraylib.so",
  "/usr/lib/arm-linux-gnueabihf/libraylib.so",
  // Windows (raylib standard installer, w64devkit, MSYS2, vcpkg)
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
  // Local bundled assets fallback
  "assets/lib/libraylib.dylib",
  "assets/lib/libraylib.so",
  "assets/lib/raylib.dll",
  "../assets/lib/libraylib.dylib",
  "../assets/lib/libraylib.so",
];

export const SYSTEM_HEADER_CANDIDATES: readonly string[] = [
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
  // Local bundled assets fallback
  "assets/include/raylib.h",
  "../assets/include/raylib.h",
];

const LIB_FILE_NAMES: readonly string[] = [
  "libraylib.dylib",
  "libraylib.so",
  "libraylib.a",
  "raylib.lib",
  "raylib.dll",
];

function tryPkgConfig(variable: string): string | null {
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
 * Searches for libraylib across Linux, macOS, Windows, pkg-config, and environment variables.
 */
export function findRaylibLibrary(explicit?: string): string | null {
  if (explicit && explicit !== "auto") {
    if (existsSync(explicit)) {
      return explicit;
    }
    // Check if explicit is a directory containing raylib library
    for (const sub of [
      "libraylib.dylib", "libraylib.so", "raylib.dll", "libraylib.a", "raylib.lib",
      "lib/libraylib.dylib", "lib/libraylib.so", "lib/raylib.dll", "lib/raylib.lib",
      "src/libraylib.dylib", "src/libraylib.so", "src/raylib.dll",
    ]) {
      const p = join(explicit, sub);
      if (existsSync(p)) return p;
    }
  }

  if (process.env.RAYLIB_LIB && existsSync(process.env.RAYLIB_LIB)) {
    return process.env.RAYLIB_LIB;
  }

  if (process.env.RAYLIB_PATH) {
    for (const sub of [
      "lib/libraylib.dylib", "lib/libraylib.so", "lib/raylib.dll", "lib/raylib.lib",
      "src/libraylib.dylib", "src/libraylib.so", "src/raylib.dll",
      "libraylib.dylib", "libraylib.so", "raylib.dll", "libraylib.a", "raylib.lib",
    ]) {
      const p = join(process.env.RAYLIB_PATH, sub);
      if (existsSync(p)) return p;
    }
  }

  const pcLibDir = tryPkgConfig("libdir");
  if (pcLibDir) {
    for (const name of LIB_FILE_NAMES) {
      const p = join(pcLibDir, name);
      if (existsSync(p)) return p;
    }
  }

  for (const c of SYSTEM_LIB_CANDIDATES) {
    if (existsSync(c)) return c;
  }

  return null;
}

/**
 * Searches for raylib.h across Linux, macOS, Windows, pkg-config, and environment variables.
 */
export function findRaylibHeader(explicit?: string): string | null {
  if (explicit && explicit !== "auto") {
    if (existsSync(explicit)) return explicit;
    for (const sub of ["include/raylib.h", "src/raylib.h", "raylib.h"]) {
      const p = join(explicit, sub);
      if (existsSync(p)) return p;
    }
  }

  if (process.env.RAYLIB_H && existsSync(process.env.RAYLIB_H)) {
    return process.env.RAYLIB_H;
  }

  if (process.env.RAYLIB_PATH) {
    for (const sub of ["include/raylib.h", "src/raylib.h", "raylib.h"]) {
      const p = join(process.env.RAYLIB_PATH, sub);
      if (existsSync(p)) return p;
    }
  }

  const pcIncDir = tryPkgConfig("includedir");
  if (pcIncDir && existsSync(join(pcIncDir, "raylib.h"))) {
    return join(pcIncDir, "raylib.h");
  }

  for (const c of SYSTEM_HEADER_CANDIDATES) {
    if (existsSync(c)) return c;
  }

  return null;
}

/**
 * Resolves the directory the native linker should search for raylib.
 */
export function findRaylibLinkDir(explicit?: string): string | null {
  if (process.env.LIBRARY_PATH) return process.env.LIBRARY_PATH;

  const pcLibDir = tryPkgConfig("libdir");
  if (pcLibDir && existsSync(pcLibDir)) return pcLibDir;

  const lib = findRaylibLibrary(explicit);
  return lib ? dirname(lib) : null;
}

let current: RaylibConfig = {};

/**
 * Read or update the raylib configuration.
 *
 * Accepts an explicit path string (e.g. `config("/opt/homebrew/lib")`), a configuration
 * object, or can be called without arguments to automatically discover raylib in default
 * system locations (Homebrew, /usr/local, /usr/lib, MSYS2, vcpkg, etc.).
 *
 * Examples:
 * ```ts
 * import { config, Raylib } from "@dayme/scriptc-raylib";
 *
 * // 1. Automatic discovery in default locations:
 * config();
 *
 * // 2. Explicit path to raylib library or directory:
 * config("/opt/homebrew/lib");
 *
 * // 3. Through the Raylib namespace:
 * Raylib.config("C:/raylib/raylib/src");
 * ```
 */
export function config(cfg?: RaylibConfig | string): RaylibConfig {
  const cfgObj: RaylibConfig = typeof cfg === "string" ? { raylibPath: cfg } : (cfg ?? {});

  current = {
    ...current,
    ...cfgObj,
  };

  const targetLib = findRaylibLibrary(current.raylibPath);
  if (targetLib) {
    current.resolvedRaylibPath = targetLib;
    current.linkDir = dirname(targetLib);

    if (!process.env.LIBRARY_PATH) {
      process.env.LIBRARY_PATH = current.linkDir;
    }
  }

  const targetHeader = findRaylibHeader(current.headerPath);
  if (targetHeader) {
    current.resolvedHeaderPath = targetHeader;
  }

  return current;
}