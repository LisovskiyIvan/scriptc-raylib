/**
 * Runtime configuration holder for craylib.
 *
 * This module is imported by `src/index.ts`, which means it is compiled into
 * every game binary. It therefore must stay free of Node.js builtins: no
 * `node:fs`, no `node:child_process`. Linking against raylib happens at build
 * time (the FFI manifest names it as a system library and the toolchain
 * resolves it through LIBRARY_PATH), so nothing here needs filesystem access.
 *
 * Build-time discovery of raylib lives in `tools/resolve_raylib.ts`.
 */

export interface RaylibConfig {
  /**
   * Directory or library file the native linker should search for raylib.
   * Normally set through the LIBRARY_PATH environment variable or
   * `tools/resolve_raylib.ts`, not from game code.
   */
  raylibPath?: string;

  /**
   * Path to raylib headers, used when regenerating bindings from raylib.h.
   */
  headerPath?: string;

  /**
   * Path to the FFI manifest passed to scriptc via --ffi.
   */
  manifestPath?: string;
}

let current: RaylibConfig = {};

/**
 * Read or update the runtime configuration.
 *
 * Linking against raylib is resolved when the executable is built, so calling
 * this from game code only records values for later inspection. To point the
 * build at a specific raylib, set LIBRARY_PATH (or pass the library path to
 * `bun tools/build.ts`) instead of calling this at runtime.
 *
 * Example:
 * ```ts
 * import { Raylib } from "craylib";
 *
 * Raylib.config({ raylibPath: "/opt/homebrew/lib" });
 * console.log(Raylib.config().raylibPath);
 * ```
 */
export function config(cfg?: RaylibConfig): RaylibConfig {
  if (cfg) {
    current = { ...current, ...cfg };
  }
  return current;
}