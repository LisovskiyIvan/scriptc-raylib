import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

export interface CraylibConfig {
  /**
   * Path to the raylib library (e.g. .dylib on macOS, .so on Linux, .dll/.lib on Windows).
   * Can be set to "auto" to automatically discover raylib on the current operating system.
   * When specified, updates gen/raylib_ffi.json so that the native linker finds it.
   */
  raylibPath?: string;

  /**
   * Path to raylib headers directory or raylib.h file.
   */
  headerPath?: string;

  /**
   * Base directory for game assets. Default: "./assets"
   */
  assetsDir?: string;

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
}

/**
 * Searches for libraylib across Linux, macOS, Windows, and local bundled assets.
 */
export function findRaylibLibrary(explicit?: string): string | null {
  if (explicit && explicit !== "auto" && existsSync(explicit)) return explicit;

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

  // pkg-config check (Linux, macOS, MSYS2)
  try {
    const pcLibDir = execSync("pkg-config --variable=libdir raylib 2>/dev/null", { encoding: "utf-8" }).trim();
    if (pcLibDir) {
      for (const name of ["libraylib.so", "libraylib.dylib", "libraylib.a", "raylib.lib", "raylib.dll"]) {
        const p = join(pcLibDir, name);
        if (existsSync(p)) return p;
      }
    }
  } catch {}

  const candidates = [
    // Linux (Debian, Ubuntu, Arch, Fedora, openSUSE)
    "/usr/lib/libraylib.so",
    "/usr/lib64/libraylib.so",
    "/usr/local/lib/libraylib.so",
    "/usr/lib/x86_64-linux-gnu/libraylib.so",
    "/usr/lib/aarch64-linux-gnu/libraylib.so",
    "/usr/lib/arm-linux-gnueabihf/libraylib.so",
    // macOS (Homebrew ARM/Intel, MacPorts)
    "/opt/homebrew/lib/libraylib.dylib",
    "/usr/local/lib/libraylib.dylib",
    "/opt/local/lib/libraylib.dylib",
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

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return null;
}

/**
 * Searches for raylib.h across Linux, macOS, Windows, and local bundled assets.
 */
export function findRaylibHeader(explicit?: string): string | null {
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

  // pkg-config check (Linux, macOS, MSYS2)
  try {
    const pcIncDir = execSync("pkg-config --variable=includedir raylib 2>/dev/null", { encoding: "utf-8" }).trim();
    if (pcIncDir && existsSync(join(pcIncDir, "raylib.h"))) {
      return join(pcIncDir, "raylib.h");
    }
  } catch {}

  const candidates = [
    // Linux (Debian, Ubuntu, Arch, Fedora)
    "/usr/include/raylib.h",
    "/usr/local/include/raylib.h",
    "/usr/include/x86_64-linux-gnu/raylib.h",
    "/usr/include/aarch64-linux-gnu/raylib.h",
    // macOS (Homebrew ARM/Intel, MacPorts)
    "/opt/homebrew/include/raylib.h",
    "/usr/local/include/raylib.h",
    "/opt/local/include/raylib.h",
    // Windows (raylib installer, w64devkit, MSYS2, vcpkg)
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

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return null;
}

let _config: CraylibConfig = {
  assetsDir: "./assets",
};

/**
 * Configure craylib runtime settings or set a custom path to the raylib library.
 * Supports auto-detection on Linux, macOS, and Windows.
 *
 * Example:
 * ```ts
 * import { Raylib } from "craylib";
 *
 * // Explicit path (Linux, macOS, or Windows):
 * Raylib.config({
 *   raylibPath: "/usr/lib/libraylib.so", // Linux
 *   // raylibPath: "/opt/homebrew/lib/libraylib.dylib", // macOS
 *   // raylibPath: "C:/raylib/raylib/src/raylib.dll", // Windows
 *   assetsDir: "./assets"
 * });
 *
 * // Or automatic cross-platform discovery:
 * Raylib.config({ raylibPath: "auto" });
 * ```
 */
export function config(cfg?: CraylibConfig): CraylibConfig {
  if (!cfg) {
    _config.resolvedRaylibPath = findRaylibLibrary() ?? undefined;
    _config.resolvedHeaderPath = findRaylibHeader() ?? undefined;
    return _config;
  }

  _config = {
    ..._config,
    ...cfg,
  };

  const targetLibPath =
    cfg.raylibPath === "auto"
      ? findRaylibLibrary()
      : (cfg.raylibPath ?? _config.resolvedRaylibPath);

  if (targetLibPath) {
    _config.resolvedRaylibPath = targetLibPath;
    const candidateManifests = [
      cfg.manifestPath,
      "gen/raylib_ffi.json",
      "../gen/raylib_ffi.json",
      "node_modules/craylib/gen/raylib_ffi.json",
    ].filter(Boolean) as string[];

    for (const p of candidateManifests) {
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, "utf-8");
          const manifest = JSON.parse(raw);
          const libs: string[] = manifest.libraries ?? ["./libraylib_shim.a"];
          if (!libs.includes(targetLibPath)) {
            manifest.libraries = [libs[0] ?? "./libraylib_shim.a", targetLibPath];
            writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n");
          }
          break;
        } catch {
          // ignore write errors in read-only / bundle environments
        }
      }
    }
  }

  if (cfg.headerPath) {
    _config.resolvedHeaderPath = findRaylibHeader(cfg.headerPath) ?? cfg.headerPath;
  } else if (!_config.resolvedHeaderPath) {
    _config.resolvedHeaderPath = findRaylibHeader() ?? undefined;
  }

  return _config;
}
