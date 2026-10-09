/**
 * Type declarations for lib/resolve_raylib.mjs, which is plain ESM so it runs
 * under Node.js without a build step and ships in the npm package.
 */

export interface RaylibProjectConfig {
  source: string;
  dir: string;
  path?: string;
  lib?: string;
  header?: string;
}

export declare function findProjectConfig(startDir?: string): RaylibProjectConfig | null;
export declare function findRaylibLibrary(explicit?: string): string | null;
export declare function findRaylibHeader(explicit?: string): string | null;
export declare function findRaylibLinkDir(): string | null;