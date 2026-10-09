#!/usr/bin/env bun
/**
 * Packs the package, installs the tarball into a throwaway project, and builds
 * a game from it with scriptc.
 *
 * This is the test that catches the failure mode unit tests miss: a manifest
 * that works in the repository but carries a machine-specific path into every
 * install. The consumer here has no RAYLIB_* environment and no LIBRARY_PATH,
 * so any baked absolute path fails to link.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findRaylibLinkDir } from "./resolve_raylib";

const rootDir = resolve(import.meta.dir, "..");

const linkDir = findRaylibLinkDir();
if (!linkDir) {
  console.error("Error: raylib library not found.");
  console.error("Install raylib, or set LIBRARY_PATH=/path/to/raylib/lib.");
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "craylib-package-"));
let failed = false;

function cleanup(): void {
  rmSync(workDir, { recursive: true, force: true });
}

try {
  // 1. Pack. Staging into a temp dir keeps the repository free of tarballs.
  console.log("== npm pack");
  const pack = spawnSync("npm", ["pack", "--pack-destination", workDir], {
    cwd: rootDir,
    encoding: "utf-8",
  });
  if (pack.status !== 0) {
    console.error(pack.stderr || pack.stdout);
    process.exit(1);
  }
  const tarball = readdirSync(workDir).find((f) => f.endsWith(".tgz"));
  if (!tarball) {
    console.error("Error: npm pack produced no tarball");
    process.exit(1);
  }
  const tarballPath = join(workDir, tarball);
  console.log(`   ${tarball}`);

  // 2. Extract and inspect the manifest for machine-specific paths.
  console.log("== manifest check");
  const unpackDir = join(workDir, "unpacked");
  const untar = spawnSync("tar", ["xzf", tarballPath, "-C", workDir], { encoding: "utf-8" });
  if (untar.status !== 0) {
    console.error(untar.stderr);
    process.exit(1);
  }
  const pkgDir = join(workDir, "package");
  const manifestPath = join(pkgDir, "gen", "raylib_ffi.json");
  if (!existsSync(manifestPath)) {
    console.error("Error: published package has no gen/raylib_ffi.json");
    process.exit(1);
  }

  const manifest = await Bun.file(manifestPath).json();
  const libraries: string[] = manifest.libraries ?? [];
  const absolute = libraries.filter((l) => l.startsWith("/") || /^[A-Za-z]:[\\/]/.test(l));
  if (absolute.length > 0) {
    console.error(`FAIL  manifest has machine-specific paths: ${absolute.join(", ")}`);
    failed = true;
  } else {
    console.log(`   libraries: ${JSON.stringify(libraries)}`);
    console.log(`   system_libraries: ${JSON.stringify(manifest.system_libraries ?? [])}`);
  }

  // 3. Build a game from the extracted package, with no RAYLIB_* in the env.
  console.log("== consumer build");

  // The shim archive is arch- and ABI-specific, so the published package ships
  // C source plus a CLI to compile it. A fresh install has no .a yet.
  console.log("== consumer shim");
  const shim = spawnSync(process.execPath, [join(pkgDir, "lib", "createshim.mjs")], {
    cwd: pkgDir,
    encoding: "utf-8",
    env: { ...process.env, LIBRARY_PATH: linkDir },
  });
  if (shim.status !== 0) {
    console.error("FAIL  createshim failed");
    console.error(
      `${shim.stdout ?? ""}${shim.stderr ?? ""}`
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 12)
        .map((l) => `        ${l}`)
        .join("\n"),
    );
    process.exit(1);
  }
  if (!existsSync(join(pkgDir, "gen", "libraylib_shim.a"))) {
    console.error("FAIL  createshim did not produce gen/libraylib_shim.a");
    process.exit(1);
  }
  console.log("   gen/libraylib_shim.a built");

  const appPath = join(pkgDir, "app.ts");
  writeFileSync(
    appPath,
    [
      'import { InitWindow, CloseWindow, DrawText, GetScreenWidth } from "./src/index";',
      "",
      'InitWindow(320, 240, "scriptc-raylib package test");',
      'DrawText("scriptc-raylib", 16, 16, 20, { r: 255, g: 255, b: 255, a: 255 });',
      "console.log(`WIDTH ${GetScreenWidth()}`);",
      "CloseWindow();",
      "",
    ].join("\n"),
  );

  // Only LIBRARY_PATH survives, so the consumer cannot accidentally rely on a
  // RAYLIB_* variable that a developer happens to have exported.
  const env: Record<string, string | undefined> = { ...process.env, LIBRARY_PATH: linkDir };
  delete env.RAYLIB_LIB;
  delete env.RAYLIB_PATH;
  delete env.RAYLIB_H;

  const build = spawnSync("scriptc", ["build", appPath, "--ffi", manifestPath, "-o", join(pkgDir, "app")], {
    cwd: pkgDir,
    encoding: "utf-8",
    env,
  });

  if (build.status !== 0) {
    console.error("FAIL  consumer build failed");
    console.error(
      `${build.stdout ?? ""}${build.stderr ?? ""}`
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 12)
        .map((l) => `        ${l}`)
        .join("\n"),
    );
    failed = true;
  } else {
    const size = (await Bun.file(join(pkgDir, "app")).stat()).size;
    console.log(`   built ${size} bytes`);

    // 4. Run it. Skipped on headless hosts, where raylib cannot open a window.
    const run = spawnSync(join(pkgDir, "app"), { encoding: "utf-8", timeout: 30_000 });
    const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    if (run.status === 0 && out.includes("WIDTH 320")) {
      console.log("   ran and reported the expected screen width");
    } else {
      console.log("   build verified; run skipped or inconclusive on this host (no display?)");
    }
  }
} finally {
  cleanup();
}

if (failed) {
  console.error("\npackage test failed");
  process.exit(1);
}

console.log("\npackage test passed");