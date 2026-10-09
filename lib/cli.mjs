#!/usr/bin/env node
/**
 * @dayme/scriptc-raylib CLI
 *
 * Usage:
 *   npx @dayme/scriptc-raylib init [path]   create raylib.json and compile native shim
 *   npx @dayme/scriptc-raylib [build]       compile shim using raylib.json or auto-discovery
 *   npx @dayme/scriptc-raylib paths         print where raylib was found
 *   npx @dayme/scriptc-raylib help          print help
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectConfig, findRaylibHeader, findRaylibLibrary, findRaylibLinkDir } from "./resolve_raylib.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`@dayme/scriptc-raylib: ${message}`);
  process.exit(1);
}

function deriveRaylibRoot(libOrHeaderPath) {
  if (!libOrHeaderPath) return null;
  const dir = dirname(libOrHeaderPath);
  const parent = dirname(dir);
  const base = dir.split(/[\\/]/).pop();
  if (base === "lib" || base === "include" || base === "bin" || base === "src") {
    return parent;
  }
  return dir;
}

function cmdInit(customPath, force = false) {
  const target = join(process.cwd(), "raylib.json");
  let determinedPath = customPath;

  if (existsSync(target) && !force) {
    console.log(`raylib.json already exists: ${target} (use --force to overwrite)`);
  } else {
    if (!determinedPath) {
      const lib = findRaylibLibrary();
      const header = findRaylibHeader();
      determinedPath = deriveRaylibRoot(lib) ?? deriveRaylibRoot(header) ?? "path/to/raylib";
    }

    const content = {
      $schema: "https://raw.githubusercontent.com/LisovskiyIvan/scriptc-raylib/main/raylib.schema.json",
      path: determinedPath,
    };

    writeFileSync(target, JSON.stringify(content, null, 2) + "\n");
    console.log(`Created raylib.json in ${process.cwd()}:`);
    console.log(JSON.stringify(content, null, 2));
    console.log("");
  }

  // If raylib was found or explicitly specified, compile the shim immediately!
  const header = findRaylibHeader();
  const library = findRaylibLibrary();
  if (header && library) {
    cmdShim();
  } else {
    console.log("Please specify the path to your raylib installation in raylib.json, then run:");
    console.log("  npx @dayme/scriptc-raylib");
  }
}

function cmdPaths() {
  const cfg = findProjectConfig();
  if (cfg) {
    console.log(`config:     ${cfg.source}${cfg.path ? ` -> path: ${cfg.path}` : ""}${cfg.lib ? ` -> lib: ${cfg.lib}` : ""}`);
  } else {
    console.log(`config:     (none, using auto-discovery & environment)`);
  }

  const header = findRaylibHeader();
  const library = findRaylibLibrary();
  const linkDir = findRaylibLinkDir();

  console.log(`header:     ${header ?? "(not found)"}`);
  console.log(`library:    ${library ?? "(not found)"}`);
  console.log(`link dir:   ${linkDir ?? "(not found)"}`);

  if (!library || !header) {
    console.error("\nraylib not found. You can configure it by:");
    console.error("  1. Running 'npx @dayme/scriptc-raylib init' to create raylib.json");
    console.error("  2. Running 'npx @dayme/scriptc-raylib init <path-to-raylib>'");
    console.error("  3. Installing raylib on your system:");
    console.error("       macOS:   brew install raylib");
    console.error("       Debian:  sudo apt install libraylib-dev");
    console.error("       Arch:    sudo pacman -S raylib");
    console.error("       Fedora:  sudo dnf install raylib-devel");
    console.error("       Windows: vcpkg install raylib:x64-windows");
    process.exit(1);
  }
}

function cmdShim(explicitPath, saveConfig = false) {
  if (explicitPath) {
    process.env.RAYLIB_PATH = explicitPath;
    if (saveConfig) {
      cmdInit(explicitPath, true);
      return;
    }
  }

  const cfg = findProjectConfig();
  if (cfg) {
    console.log(`config:   ${cfg.source}`);
  }

  const header = findRaylibHeader();
  if (!header) {
    fail(`raylib.h not found.
To configure raylib:
  1. Run 'npx @dayme/scriptc-raylib init' to generate a raylib.json configuration file.
  2. Or run 'npx @dayme/scriptc-raylib init <path-to-raylib>' (e.g. npx @dayme/scriptc-raylib init /opt/homebrew).
  3. Or install raylib globally on your system:
       macOS:   brew install raylib
       Debian:  sudo apt install libraylib-dev
       Arch:    sudo pacman -S raylib
       Fedora:  sudo dnf install raylib-devel
       Windows: vcpkg install raylib:x64-windows`);
  }

  const shimSource = join(pkgRoot, "gen", "raylib_shim.c");
  if (!existsSync(shimSource)) {
    fail(`missing ${shimSource}`);
  }

  const objectPath = join(pkgRoot, "gen", "raylib_shim.o");
  const archivePath = join(pkgRoot, "gen", "libraylib_shim.a");
  const isWindows = process.platform === "win32";
  const cc = process.env.CC ?? (isWindows ? "gcc" : "cc");
  const ar = process.env.AR ?? (isWindows ? "ar" : "ar");

  console.log(`header:   ${header}`);
  console.log(`compiler: ${cc}`);

  let cflags = `-I"${dirname(header)}"`;
  try {
    const pc = spawnSync("pkg-config", ["--cflags", "raylib"], { encoding: "utf-8" }).stdout?.trim();
    if (pc) cflags = pc;
  } catch {
    // pkg-config is optional; the include path above is enough.
  }

  const compile = spawnSync(cc, ["-O2", "-c", shimSource, "-o", objectPath, cflags], {
    stdio: "inherit",
    shell: isWindows,
  });
  if (compile.status !== 0) {
    fail("compiling gen/raylib_shim.c failed");
  }

  const archive = spawnSync(ar, ["rcs", archivePath, objectPath], {
    stdio: "inherit",
    shell: isWindows,
  });
  if (archive.status !== 0) {
    fail("creating gen/libraylib_shim.a failed");
  }

  const manifest = join(pkgRoot, "gen", "raylib_ffi.json");

  console.log(`\nshim:     ${archivePath}`);
  const library = findRaylibLibrary();
  if (!library) {
    fail(`Compiled shim, but could not find raylib library binary.
Please specify the path in raylib.json ("path" or "lib") or run 'npx @dayme/scriptc-raylib init <path>'.`);
  }

  console.log(`library:  ${library}`);

  if (existsSync(manifest)) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, "utf-8"));
      parsed.libraries = ["./libraylib_shim.a", library];
      parsed.system_libraries = [];
      writeFileSync(manifest, JSON.stringify(parsed, null, 2) + "\n");
    } catch {}
  }

  if (existsSync(manifest)) {
    const parsed = JSON.parse(readFileSync(manifest, "utf-8"));
    console.log(`functions: ${parsed.functions?.length ?? 0} (ffi_format ${parsed.ffi_format})`);
  }

  const consumerDir = process.cwd();
  if (resolve(consumerDir) !== resolve(pkgRoot)) {
    const linkTarget = join(consumerDir, "raylib");
    if (!existsSync(linkTarget)) {
      try {
        const isWindows = process.platform === "win32";
        if (isWindows) {
          // On Windows, NTFS junctions do not require administrator privileges or Developer Mode
          symlinkSync(resolve(pkgRoot), linkTarget, "junction");
        } else {
          const relPkg = relative(consumerDir, pkgRoot);
          symlinkSync(relPkg, linkTarget, "dir");
        }
        console.log(`linked:   ./raylib -> ${pkgRoot}`);
      } catch {
        try {
          // Fallback if links/junctions are not supported on filesystem: copy folder
          cpSync(pkgRoot, linkTarget, { recursive: true });
          console.log(`copied:   ./raylib -> ${pkgRoot} (symlinks not supported on drive)`);
        } catch {
          // ignore
        }
      }
    }

    const tsconfigPath = join(consumerDir, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      try {
        const raw = readFileSync(tsconfigPath, "utf-8");
        const clean = raw.replace(/\/\/.*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        const tsconfig = JSON.parse(clean);
        tsconfig.compilerOptions = tsconfig.compilerOptions || {};
        const paths = tsconfig.compilerOptions.paths || {};
        const currentPath = paths["@dayme/scriptc-raylib"]?.[0];
        if (!currentPath || currentPath.includes("node_modules")) {
          paths["@dayme/scriptc-raylib"] = ["./raylib/src/index.ts"];
          tsconfig.compilerOptions.paths = paths;
          writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
          console.log("tsconfig: mapped @dayme/scriptc-raylib to ./raylib/src/index.ts (enables 100% static compilation)");
        }
      } catch {}
    }
  }

  const displayManifest = resolve(consumerDir) !== resolve(pkgRoot) ? relative(consumerDir, manifest) : manifest;

  console.log("\nRun your game:");
  console.log(`  scriptc run src/main.ts --ffi ${displayManifest}`);
  console.log("\nBuild your game:");
  console.log(`  scriptc build src/main.ts --ffi ${displayManifest} -o game`);
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "build" || command === "shim") {
  cmdShim();
} else if (command === "init") {
  const customPath = args.slice(1).find((a) => !a.startsWith("-"));
  const force = args.includes("--force") || args.includes("-f");
  cmdInit(customPath, force);
} else if (command === "paths") {
  cmdPaths();
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log(
    [
      "@dayme/scriptc-raylib CLI",
      "",
      "Usage:",
      "  npx @dayme/scriptc-raylib init [path]   Initialize project: create raylib.json and compile shim",
      "  npx @dayme/scriptc-raylib [build]       Compile native shim using raylib.json or auto-discovery",
      "  npx @dayme/scriptc-raylib <path>        Compile shim using custom raylib directory",
      "  npx @dayme/scriptc-raylib paths         Show discovered raylib headers, libraries, and config",
      "  npx @dayme/scriptc-raylib help          Show this help message",
      "",
      "Configuration (raylib.json in project root):",
      "  {",
      '    "path": "/opt/homebrew",',
      '    "lib": "/opt/homebrew/lib/libraylib.dylib",',
      '    "header": "/opt/homebrew/include/raylib.h"',
      "  }",
      "",
    ].join("\n"),
  );
} else if (command === "--path" || command === "-p") {
  const p = args[1];
  if (!p) fail("missing argument for --path");
  cmdShim(p, args.includes("--save"));
} else if (existsSync(command) || command.startsWith("/") || command.startsWith(".") || /^[A-Za-z]:/.test(command)) {
  cmdShim(command, args.includes("--save"));
} else {
  fail(`unknown command or invalid path: ${command} (run 'npx @dayme/scriptc-raylib help' for usage)`);
}
