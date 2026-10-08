/**
 * Type declarations for lib/resolve_raylib.mjs, which is plain ESM so it runs
 * under Node.js without a build step and ships in the npm package.
 */

export declare function findRaylibLibrary(explicit?: string): string | null;
export declare function findRaylibHeader(explicit?: string): string | null;
export declare function findRaylibLinkDir(): string | null;