import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface CraylibConfig {
  /**
   * Path to the raylib library (e.g. "/opt/homebrew/lib/libraylib.dylib" or "./assets/lib/libraylib.dylib").
   * When specified, updates gen/raylib_ffi.json so that the native linker finds it.
   */
  raylibPath?: string;

  /**
   * Path to raylib headers directory (containing raylib.h).
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
}

let _config: CraylibConfig = {
  assetsDir: "./assets",
};

/**
 * Configure craylib runtime settings or set a custom path to the raylib library.
 *
 * Example:
 * ```ts
 * import { Raylib } from "craylib";
 *
 * Raylib.config({
 *   raylibPath: "/opt/homebrew/lib/libraylib.dylib",
 *   assetsDir: "./assets"
 * });
 * ```
 */
export function config(cfg?: CraylibConfig): CraylibConfig {
  if (!cfg) return _config;

  _config = {
    ..._config,
    ...cfg,
  };

  if (cfg.raylibPath) {
    const candidatePaths = [
      cfg.manifestPath,
      "gen/raylib_ffi.json",
      "../gen/raylib_ffi.json",
      "node_modules/craylib/gen/raylib_ffi.json",
    ].filter(Boolean) as string[];

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, "utf-8");
          const manifest = JSON.parse(raw);
          const libs: string[] = manifest.libraries ?? ["./libraylib_shim.a"];
          if (!libs.includes(cfg.raylibPath)) {
            manifest.libraries = [libs[0] ?? "./libraylib_shim.a", cfg.raylibPath];
            writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n");
          }
          break;
        } catch {
          // ignore write errors in read-only / bundle environments
        }
      }
    }
  }

  return _config;
}
