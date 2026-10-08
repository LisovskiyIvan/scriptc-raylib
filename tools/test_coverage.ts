#!/usr/bin/env bun
/**
 * Asserts that every example and the demo compile 100% statically.
 *
 * The whole point of craylib is a binary with no JavaScript engine, so any
 * statement that needs the embedded engine is a regression, not a warning.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const ffiManifest = join(rootDir, "gen/raylib_ffi.json");

if (!existsSync(ffiManifest)) {
  console.error("Error: gen/raylib_ffi.json is missing. Run `bun run gen` first.");
  process.exit(1);
}

const targets = [
  ...readdirSync(join(rootDir, "examples"))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => join("examples", f)),
  join("demo", "main.ts"),
];

let failed = 0;

for (const target of targets) {
  const path = join(rootDir, target);
  const result = spawnSync("scriptc", ["coverage", path, "--ffi", ffiManifest], {
    encoding: "utf-8",
    cwd: rootDir,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const label = target.padEnd(26);

  if (result.status !== 0 || output.includes("not analyzable")) {
    console.error(`FAIL  ${label} does not typecheck or analyze`);
    console.error(
      output
        .split("\n")
        .filter((l) => l.includes("error"))
        .slice(0, 4)
        .map((l) => `        ${l}`)
        .join("\n"),
    );
    failed++;
    continue;
  }

  const percent = output.match(/\((\d+)%\)/)?.[1];
  if (percent !== "100") {
    console.error(`FAIL  ${label} only ${percent}% static — engine code would be embedded`);
    console.error(
      output
        .split("\n")
        .filter((l) => /SC\d+/.test(l))
        .slice(0, 6)
        .map((l) => `        ${l}`)
        .join("\n"),
    );
    failed++;
    continue;
  }

  const statements = output.match(/compile statically\s+(\d+)/)?.[1] ?? "?";
  console.log(`ok    ${label} ${statements} statements, 100% static`);
}

if (failed > 0) {
  console.error(`\n${failed} of ${targets.length} targets failed`);
  process.exit(1);
}

console.log(`\nall ${targets.length} targets compile 100% statically`);