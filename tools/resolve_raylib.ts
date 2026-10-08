/**
 * Thin re-export so TypeScript tooling and the published CLI share one
 * implementation of raylib discovery.
 *
 * The real logic lives in `lib/resolve_raylib.mjs` because that file must run
 * under plain Node.js without a build step. It deliberately lives outside
 * `src/`, which is compiled into every game binary: importing `node:fs` or
 * `node:child_process` from `src/` would pull the Node.js filesystem and
 * process shims into the executable.
 */

export {
  findRaylibHeader,
  findRaylibLibrary,
  findRaylibLinkDir,
} from "../lib/resolve_raylib.mjs";