#!/usr/bin/env bun
/**
 * gen_bindings.ts — raylib.h → scriptc FFI bindings generator.
 *
 * Parses the raylib header (structs, enums, RLAPI prototypes) and classifies
 * every function into one of:
 *
 *   direct  — scalar-only signature: bound to the original raylib symbol,
 *             no C code at all
 *   wrap    — needs a C shim because scriptc FFI has no struct-by-value,
 *             no NUL-terminated strings and no struct returns:
 *               const char*        → `string` class (ptr,len), wrapper copies to NUL-terminated buffer
 *               struct by value    → flattened into scalar args (all-scalar structs only)
 *               struct w/ pointers → opaque round-trip via `bytes` (memcpy in the shim)
 *               struct return      → copied out through a trailing `mutable-bytes` buffer
 *   skip    — file I/O, callbacks, variadics, string/pointer returns, ... (see SKIP_* below)
 *
 * Outputs (in <outdir>):
 *   raylib_ffi.json — scriptc FFI manifest (ffi_format 6)
 *   raylib_shim.c   — C wrappers + _Static_assert(sizeof) layout checks
 *   raylib_ffi.ts   — raw `export declare function rl_*` bindings
 *   raylib.ts       — typed API: enum constants, struct interfaces, glue
 *
 * Usage: bun tools/gen_bindings.ts [raylib.h] [outdir]
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function findRaylibHeader(explicit?: string): string {
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
    const pc = execSync("pkg-config --variable=includedir raylib 2>/dev/null", { encoding: "utf-8" }).trim();
    if (pc && existsSync(join(pc, "raylib.h"))) {
      return join(pc, "raylib.h");
    }
  } catch {}

  const candidates = [
    // macOS (Homebrew ARM/Intel, MacPorts)
    "/opt/homebrew/include/raylib.h",
    "/usr/local/include/raylib.h",
    "/opt/local/include/raylib.h",
    // Linux (FHS standard, Debian/Ubuntu multiarch, Arch, Fedora)
    "/usr/include/raylib.h",
    "/usr/local/include/raylib.h",
    "/usr/include/x86_64-linux-gnu/raylib.h",
    "/usr/include/aarch64-linux-gnu/raylib.h",
    "/usr/include/arm-linux-gnueabihf/raylib.h",
    // Windows (MSYS2, w64devkit, raylib installer, vcpkg)
    "C:/raylib/raylib/src/raylib.h",
    "C:/raylib/w64devkit/x86_64-w64-mingw32/include/raylib.h",
    "C:/msys64/mingw64/include/raylib.h",
    "C:/msys64/ucrt64/include/raylib.h",
    "C:/msys64/clang64/include/raylib.h",
    "C:/vcpkg/installed/x64-windows/include/raylib.h",
    "C:/Program Files/raylib/include/raylib.h",
    "C:/Program Files (x86)/raylib/include/raylib.h",
    // Local bundled assets fallback
    resolve("assets/include/raylib.h"),
    join(import.meta.dir ?? "", "../assets/include/raylib.h"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  if (explicit) return explicit;
  return "/opt/homebrew/include/raylib.h";
}

const headerPath = findRaylibHeader(process.argv[2]);
const outDir = process.argv[3] ?? "gen";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

type Prim = "bool" | "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "i64" | "u64" | "f32" | "f64";

const PRIM_C: Record<Prim, string> = {
  bool: "bool", i8: "int8_t", u8: "uint8_t", i16: "int16_t", u16: "uint16_t",
  i32: "int32_t", u32: "uint32_t", i64: "int64_t", u64: "uint64_t", f32: "float", f64: "double",
};
const PRIM_SIZE: Record<Prim, number> = {
  bool: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, f32: 4, f64: 8,
};
const PRIM_TS: Record<Prim, string> = {
  bool: "boolean", i8: "number", u8: "number", i16: "number", u16: "number",
  i32: "number", u32: "number", i64: "bigint", u64: "bigint", f32: "number", f64: "number",
};
const PRIM_DV: Record<Prim, string> = {
  bool: "getUint8", i8: "getInt8", u8: "getUint8", i16: "getInt16", u16: "getUint16",
  i32: "getInt32", u32: "getUint32", i64: "getBigInt64", u64: "getBigUint64", f32: "getFloat32", f64: "getFloat64",
};

const PRIM_CANON: Record<string, Prim> = {
  "bool": "bool", "_Bool": "bool",
  "char": "i8", "unsigned char": "u8", "signed char": "i8",
  "short": "i16", "short int": "i16", "unsigned short": "u16", "unsigned short int": "u16",
  "int": "i32", "unsigned": "u32", "unsigned int": "u32",
  "long": "i64", "long int": "i64", "long long": "i64", "long long int": "i64",
  "unsigned long": "u64", "unsigned long int": "u64", "unsigned long long": "u64", "unsigned long long int": "u64",
  "float": "f32", "double": "f64",
};

// ---------------------------------------------------------------------------
// C type model
// ---------------------------------------------------------------------------

type CBase =
  | { t: "prim"; prim: Prim }
  | { t: "void" }
  | { t: "struct"; name: string }
  | { t: "fnptr"; name: string }
  | { t: "va" }
  | { t: "unknown"; name: string };

type CType = { base: CBase; ptr: number; arrLen?: number };

interface StructField { name: string; type: CType }
interface StructDef { name: string; fields: StructField[] }
interface EnumDef { name: string; values: Array<{ name: string; value: number }> }
interface RawFn { ret: string; name: string; params: Array<{ type: string; name: string }>; variadic: boolean }

interface HeaderCtx {
  structs: Map<string, StructDef>;       // resolved name -> def
  structNames: Set<string>;              // every struct tag seen (incl. opaque forwards)
  aliases: Map<string, { target: string; ptr: number }>;
  fnptrs: Set<string>;
}

const alignUp = (n: number, a: number): number => (a <= 1 ? n : Math.ceil(n / a) * a);

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function parseTypeText(text: string, ctx: HeaderCtx): CType {
  const tokens = text.match(/\*|[A-Za-z_]\w*/g) ?? [];
  let ptr = 0;
  const words: string[] = [];
  for (const tok of tokens) {
    if (tok === "*") { ptr++; continue; }
    if (tok === "const" || tok === "volatile" || tok === "struct" || tok === "enum" || tok === "signed") continue;
    words.push(tok);
  }
  const w = words.join(" ");
  let base: CBase;
  if (PRIM_CANON[w] !== undefined) base = { t: "prim", prim: PRIM_CANON[w] };
  else if (w === "void") base = { t: "void" };
  else if (w === "va_list") base = { t: "va" };
  else if (ctx.fnptrs.has(w)) base = { t: "fnptr", name: w };
  else if (ctx.structNames.has(w) || ctx.aliases.has(w)) base = { t: "struct", name: w };
  else base = { t: "unknown", name: w };
  return { base, ptr };
}

/** Resolve type aliases (Camera -> Camera3D, ModelAnimPose -> Transform +1 ptr). */
function resolveType(t: CType, ctx: HeaderCtx): CType {
  for (let guard = 0; guard < 16; guard++) {
    if (t.base.t !== "struct") return t;
    const alias = ctx.aliases.get(t.base.name);
    if (!alias) return t;
    t = { base: { t: "struct", name: alias.target }, ptr: t.ptr + alias.ptr, arrLen: t.arrLen };
  }
  throw new Error("alias resolution loop");
}

function parseHeader(src: string, ctx: HeaderCtx): void {
  const text = stripComments(src);

  // Pass 1: collect all type names first (struct bodies reference aliases).
  for (const m of text.matchAll(/typedef\s+struct\s+(\w+)?\s*\{/g)) {
    if (m[1]) ctx.structNames.add(m[1]);
  }
  for (const m of text.matchAll(/typedef\s+struct\s+(\w+)\s+(\w+)\s*;/g)) {
    ctx.structNames.add(m[2]);
  }
  for (const m of text.matchAll(/typedef\s+[\w\s*]+?\(\s*\*\s*(\w+)\s*\)\s*\([^;]*\)\s*;/g)) {
    ctx.fnptrs.add(m[1]);
  }
  for (const m of text.matchAll(/^typedef\s+(?!struct\b|enum\b)(\w+)\s*(\*?)\s*(\w+)\s*;\s*$/gm)) {
    const [, target, star, name] = m;
    if (ctx.structNames.has(name) || ctx.fnptrs.has(name)) continue;
    ctx.aliases.set(name, { target, ptr: star === "*" ? 1 : 0 });
  }

  // Pass 2: struct bodies: typedef struct [Tag] { ... } Name;
  const structBodyRe = /typedef\s+struct\s+(\w+)?\s*\{([^}]*)\}\s*(\w+)\s*;/g;
  for (const m of text.matchAll(structBodyRe)) {
    const [, , body, name] = m;
    const fields: StructField[] = [];
    const addField = (typeText: string, declName: string, arr?: string) => {
      const type = parseTypeText(typeText, ctx);
      if (arr !== undefined) {
        const n = Number(arr);
        if (!Number.isInteger(n) || n <= 0) throw new Error(`struct ${name}: bad array length ${arr} on field ${declName}`);
        type.arrLen = n;
      }
      fields.push({ name: declName, type });
    };
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim().replace(/;$/, "");
      if (line === "") continue;
      // Multiple declarators share one type: `float m0, m4, m8, m12;`
      const pieces = line.split(",");
      const first = pieces[0].match(/^(.+?)\s*\b([A-Za-z_]\w*)\s*(?:\[\s*(\w+)\s*\])?$/);
      if (!first) continue; // not a field line (stray comment etc.)
      addField(first[1], first[2], first[3]);
      for (const piece of pieces.slice(1)) {
        const dm = piece.match(/^\s*(\*?)\s*([A-Za-z_]\w*)\s*(?:\[\s*(\w+)\s*\])?$/);
        if (!dm) continue;
        addField(first[1] + (dm[1] === "*" ? " *" : ""), dm[2], dm[3]);
      }
    }
    ctx.structs.set(name, { name, fields });
  }

  // Pass 3: enums
  const enumRe = /typedef\s+enum\s*(\w+)?\s*\{([^}]*)\}\s*(\w+)\s*;/g;
  for (const m of text.matchAll(enumRe)) {
    const [, , body, name] = m;
    const values: EnumDef["values"] = [];
    let next = 0;
    for (const rawLine of body.split("\n")) {
      const em = rawLine.trim().match(/^([A-Za-z_]\w*)\s*(?:=\s*(.+?))?\s*,?$/);
      if (!em) continue;
      let value: number;
      if (em[2] !== undefined) {
        const v = em[2].trim();
        if (/^(0[xX][0-9a-fA-F]+|\d+)$/.test(v)) value = Number(v);
        else if (/^[-0xX0-9a-fA-F()<>|&+\s]+$/.test(v)) value = Function(`"use strict"; return (${v});`)() as number;
        else continue; // non-numeric expression (e.g. `true = !false`) — skip entry
      } else {
        value = next;
      }
      value = Number(value);
      next = value + 1;
      values.push({ name: em[1], value });
    }
    if (values.length > 0) enums.push({ name, values });
  }

  // Functions: RLAPI <ret> <name>(<params>);  — accumulate continuation lines.
  const fns: RawFn[] = [];
  let acc = "";
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (acc === "" && !l.startsWith("RLAPI")) continue;
    acc += (acc === "" ? "" : " ") + l;
    if (!acc.endsWith(";")) continue;
    const m = acc.match(/^RLAPI\s+(.+?)\b([A-Za-z_]\w*)\s*\((.*)\)\s*;$/);
    if (m) {
      const params: RawFn["params"] = [];
      let variadic = false;
      const paramText = m[3].trim();
      if (paramText !== "" && paramText !== "void") {
        for (const piece of paramText.split(",")) {
          const p = piece.trim();
          if (p === "...") { variadic = true; continue; }
          const pm = p.match(/^(.+?)\s*\b([A-Za-z_]\w*)\s*(\[[^\]]*\])?$/);
          if (!pm) throw new Error(`function ${m[2]}: unparseable parameter "${p}"`);
          params.push({ type: pm[1] + (pm[3] ?? ""), name: pm[2] });
        }
      }
      fns.push({ ret: m[1].trim(), name: m[2], params, variadic });
    }
    acc = "";
  }
  functions.push(...fns);
}

const enums: EnumDef[] = [];
const functions: RawFn[] = [];

// ---------------------------------------------------------------------------
// Struct layout (sizes for _Static_assert + flattening into scalar leaves)
// ---------------------------------------------------------------------------

interface Leaf { path: string[]; structPath: string[]; prim: Prim; offset: number }
interface Layout { size: number; align: number; flat: boolean; leaves: Leaf[] }

const layoutMemo = new Map<string, Layout>();
let ctx: HeaderCtx;

function layoutStruct(nameArg: string): Layout {
  const resolved = resolveType({ base: { t: "struct", name: nameArg }, ptr: 0 }, ctx);
  if (resolved.base.t !== "struct") throw new Error(`layoutStruct: ${nameArg} does not resolve to a struct`);
  const name = resolved.base.name;
  const cached = layoutMemo.get(name);
  if (cached) return cached;
  const def = ctx.structs.get(name);
  if (!def) throw new Error(`layoutStruct: unknown struct ${name}`);
  layoutMemo.set(name, { size: 0, align: 1, flat: false, leaves: [] }); // cycle guard

  let offset = 0;
  let maxAlign = 1;
  let flat = true;
  const leaves: Leaf[] = [];

  for (const f of def.fields) {
    const t = resolveType(f.type, ctx);

    if (t.ptr > 0) {
      // Any pointer field (incl. void*) makes the struct opaque; ABI size is 8.
      flat = false;
      offset = alignUp(offset, 8) + 8;
      maxAlign = Math.max(maxAlign, 8);
      continue;
    }

    if (t.base.t === "void" || t.base.t === "va") throw new Error(`struct ${name}.${f.name}: unexpected void/va_list field`);

    if (t.base.t === "unknown" || t.base.t === "fnptr") {
      flat = false;
      offset = alignUp(offset, 8) + 8;
      maxAlign = Math.max(maxAlign, 8);
      continue;
    }

    if (t.arrLen !== undefined) {
      // Arrays (incl. char[32]) are passed opaquely, never flattened.
      flat = false;
      const elem = t.base.t === "prim" ? PRIM_SIZE[t.base.prim] : t.base.t === "struct" ? layoutStruct(t.base.name).size : 8;
      const elemAlign = t.base.t === "prim" ? PRIM_SIZE[t.base.prim] : t.base.t === "struct" ? layoutStruct(t.base.name).align : 8;
      offset = alignUp(offset, elemAlign) + elem * t.arrLen;
      maxAlign = Math.max(maxAlign, elemAlign);
      continue;
    }

    if (t.base.t === "prim") {
      const p = t.base.prim;
      const sz = PRIM_SIZE[p];
      offset = alignUp(offset, sz);
      if (flat) leaves.push({ path: [f.name], structPath: [name], prim: p, offset });
      offset += sz;
      maxAlign = Math.max(maxAlign, sz);
      continue;
    }

    // Nested struct
    const sub = layoutStruct(t.base.name);
    offset = alignUp(offset, sub.align);
    if (flat && sub.flat) {
      for (const l of sub.leaves) {
        leaves.push({ path: [f.name, ...l.path], structPath: [name, ...l.structPath], prim: l.prim, offset: offset + l.offset });
      }
    } else {
      flat = false;
    }
    offset += sub.size;
    maxAlign = Math.max(maxAlign, sub.align);
  }

  const layout: Layout = { size: alignUp(offset, maxAlign), align: maxAlign, flat, leaves: flat ? leaves : [] };
  layoutMemo.set(name, layout);
  return layout;
}

// ---------------------------------------------------------------------------
// Function classification
// ---------------------------------------------------------------------------

// Pure OS-filesystem management: excluded from the bindings.
const SKIP_FILE_IO: RegExp[] = [
  /^FileExists$/, /^DirectoryExists$/, /^IsPathValid$/, /^IsFileDropped$/,
  /^GetFileExtension$/, /^GetFileName$/, /^GetFileNameWithoutExt$/, /^GetDirectoryPath$/,
  /^GetWorkingDirectory$/, /^GetApplicationDirectory$/, /^ChangeDirectory$/, /^GetFileModTime$/,
  /^LoadDroppedFiles$/, /^UnloadDroppedFiles$/,
  /^LoadFileData$/, /^UnloadFileData$/, /^SaveFileData$/, /^LoadFileText$/, /^UnloadFileText$/, /^SaveFileText$/,
  /^TakeScreenshot$/, /^ExportImage$/, /^ExportImageAsCode$/, /^ExportDataAsCode$/, /^ExportMesh$/,
  /^LoadAutomationEventList$/, /^ExportAutomationEvents$/, /^SetAutomationEventList$/, /^SetAutomationEventBase$/,
];
// Manual memory management from script land makes no sense.
const SKIP_MEMORY = [/^MemAlloc$/, /^MemRealloc$/, /^MemFree$/];

type ParamPlan =
  | { k: "scalar"; name: string; prim: Prim }
  | { k: "string"; name: string }
  | { k: "bytes"; name: string }
  | { k: "flat"; name: string; structName: string; leaves: Leaf[] }
  | { k: "opaque"; name: string; structName: string; size: number };

type RetPlan = { k: "void" } | { k: "scalar"; prim: Prim } | { k: "struct-out"; structName: string; size: number };

type FnPlan =
  | { k: "direct"; tsName: string; symbol: string; params: Array<{ cls: string; ts: string }>; ret: string; retTs: string }
  | {
      k: "wrap"; tsName: string; symbol: string; params: ParamPlan[]; ret: RetPlan;
      cParams: string[]; cBody: string[]; cCall: string; manifestParams: string[]; tsParams: Array<{ name: string; ts: string }>;
    }
  | { k: "skip"; reason: string };

function primClass(p: Prim): string { return p === "bool" ? "bool" : p; }

function classify(fn: RawFn): FnPlan {
  const tsName = `rl_${fn.name}`;

  for (const re of SKIP_FILE_IO) if (re.test(fn.name)) return { k: "skip", reason: "file-io" };
  for (const re of SKIP_MEMORY) if (re.test(fn.name)) return { k: "skip", reason: "manual-memory" };

  if (fn.variadic) return { k: "skip", reason: "variadic" };

  // ---- return type ----
  const rt = resolveType(parseTypeText(fn.ret, ctx), ctx);
  let ret: RetPlan;
  if (rt.ptr === 0 && rt.arrLen === undefined && rt.base.t === "void") ret = { k: "void" };
  else if (rt.ptr === 0 && rt.arrLen === undefined && rt.base.t === "prim") ret = { k: "scalar", prim: rt.base.prim };
  else if (rt.ptr === 0 && rt.arrLen === undefined && rt.base.t === "struct") {
    const lay = layoutStruct(rt.base.name);
    ret = { k: "struct-out", structName: rt.base.name, size: lay.size };
  } else if (rt.ptr === 1 && rt.base.t === "prim" && rt.base.prim === "i8") {
    return { k: "skip", reason: "string-return" };
  } else {
    return { k: "skip", reason: "pointer-return" };
  }

  // ---- parameters ----
  const params: ParamPlan[] = [];
  for (const p of fn.params) {
    const t = resolveType(parseTypeText(p.type, ctx), ctx);
    if (t.base.t === "fnptr") return { k: "skip", reason: "callback" };
    if (t.base.t === "va") return { k: "skip", reason: "variadic" };
    if (t.base.t === "unknown") return { k: "skip", reason: `unsupported-type:${t.base.name}` };

    if (t.ptr === 0 && t.arrLen === undefined && t.base.t === "prim") {
      params.push({ k: "scalar", name: p.name, prim: t.base.prim });
      continue;
    }
    if (t.ptr === 1 && t.arrLen === undefined && t.base.t === "prim" && t.base.prim === "i8") {
      if (p.type.includes("const")) params.push({ k: "string", name: p.name });
      else return { k: "skip", reason: "mutable-pointer" };
      continue;
    }
    if (t.ptr === 1 && t.arrLen === undefined && t.base.t === "void") {
      if (p.type.includes("const")) params.push({ k: "bytes", name: p.name });
      else return { k: "skip", reason: "mutable-pointer" };
      continue;
    }
    if (t.ptr === 0 && t.arrLen === undefined && t.base.t === "struct") {
      const lay = layoutStruct(t.base.name);
      if (lay.flat) params.push({ k: "flat", name: p.name, structName: t.base.name, leaves: lay.leaves });
      else params.push({ k: "opaque", name: p.name, structName: t.base.name, size: lay.size });
      continue;
    }
    if (t.ptr >= 1 && t.base.t === "struct") return { k: "skip", reason: "struct-pointer" };
    return { k: "skip", reason: "pointer-param" };
  }

  // ---- direct binding when nothing needs marshalling ----
  const allScalar = params.every((p) => p.k === "scalar");
  const scalarRet = ret.k === "void" || ret.k === "scalar";
  if (allScalar && scalarRet) {
    const retPrim = ret.k === "scalar" ? ret.prim : null;
    return {
      k: "direct", tsName, symbol: fn.name,
      params: (params as Extract<ParamPlan, { k: "scalar" }>[]).map((p) => ({ cls: primClass(p.prim), ts: PRIM_TS[p.prim] })),
      ret: retPrim === null ? "void" : primClass(retPrim),
      retTs: retPrim === null ? "void" : PRIM_TS[retPrim],
    };
  }

  // ---- build the C wrapper ----
  const cParams: string[] = [];
  const manifestParams: string[] = [];
  const tsParams: Array<{ name: string; ts: string }> = [];
  const pre: string[] = [];   // size checks
  const allocs: string[] = []; // string buffers
  const callArgs: string[] = [];
  const locals: string[] = []; // opaque struct locals
  const frees: string[] = [];

  for (const p of params) {
    if (p.k === "scalar") {
      cParams.push(`${PRIM_C[p.prim]} ${p.name}`);
      manifestParams.push(primClass(p.prim));
      tsParams.push({ name: p.name, ts: PRIM_TS[p.prim] });
      callArgs.push(p.name);
    } else if (p.k === "string") {
      cParams.push(`const uint8_t *${p.name}_ptr`, `size_t ${p.name}_len`);
      manifestParams.push("string");
      tsParams.push({ name: p.name, ts: "string" });
      allocs.push(
        `char *${p.name}_buf = (char *)malloc(${p.name}_len + 1);`,
        `if (${p.name}_buf == NULL) return;`,
        `memcpy(${p.name}_buf, ${p.name}_ptr, ${p.name}_len);`,
        `${p.name}_buf[${p.name}_len] = '\\0';`,
      );
      frees.push(`free(${p.name}_buf);`);
      callArgs.push(`(const char *)${p.name}_buf`);
    } else if (p.k === "bytes") {
      cParams.push(`const uint8_t *${p.name}_ptr`, `size_t ${p.name}_len`);
      manifestParams.push("bytes");
      tsParams.push({ name: p.name, ts: "Uint8Array" });
      callArgs.push(`(const void *)${p.name}_ptr`);
    } else if (p.k === "opaque") {
      cParams.push(`const uint8_t *${p.name}_ptr`, `size_t ${p.name}_len`);
      manifestParams.push("bytes");
      tsParams.push({ name: p.name, ts: "Uint8Array" });
      pre.push(`if (${p.name}_len != (size_t)sizeof(${p.structName})) { return; }`);
      locals.push(`${p.structName} ${p.name};`, `memcpy(&${p.name}, ${p.name}_ptr, sizeof(${p.name}));`);
      callArgs.push(p.name);
    } else {
      // flat: expand struct into scalar C params; the call receives the rebuilt struct
      for (const leaf of p.leaves) {
        const cname = `${p.name}_${leaf.path.join("_")}`;
        cParams.push(`${PRIM_C[leaf.prim]} ${cname}`);
        manifestParams.push(primClass(leaf.prim));
      }
      tsParams.push({ name: p.name, ts: p.structName });
      callArgs.push(initExpr(p.structName, p.leaves, p.name));
    }
  }

  let cCall: string;
  if (ret.k === "struct-out") {
    cParams.push("uint8_t *out", "size_t out_len");
    manifestParams.push("mutable-bytes");
    tsParams.push({ name: "__out", ts: "Uint8Array" });
    pre.unshift(`if (out_len != (size_t)sizeof(${ret.structName})) { return; }`);
    cCall = `${ret.structName} __v = ${fn.name}(${callArgs.join(", ")});`;
    frees.push("memcpy(out, &__v, sizeof(__v));");
  } else {
    cCall = `${fn.name}(${callArgs.join(", ")});`;
  }

  const body = [...pre, ...allocs, ...locals, cCall, ...frees];
  return {
    k: "wrap", tsName, symbol: tsName, params, ret,
    cParams, cBody: body, cCall, manifestParams, tsParams,
  };
}

/** C composite-literal expression rebuilding a flattened struct from scalar args. */
function initExpr(structName: string, leaves: Leaf[], prefix: string, pathPrefix: string[] = []): string {
  const def = ctx.structs.get(structName)!;
  const parts: string[] = [];
  for (const f of def.fields) {
    const ls = leaves.filter((l) => l.path[0] === f.name);
    if (ls.length === 0) continue;
    if (ls[0].path.length === 1) {
      parts.push(`${prefix}_${[...pathPrefix, ls[0].path[0]].join("_")}`);
    } else {
      const ft = resolveType(f.type, ctx);
      parts.push(initExpr((ft.base as { name: string }).name, ls.map((l) => ({ ...l, path: l.path.slice(1) })), prefix, [...pathPrefix, f.name]));
    }
  }
  return `(${structName}){ ${parts.join(", ")} }`;
}

// ---------------------------------------------------------------------------
// TS emission helpers
// ---------------------------------------------------------------------------

const TS_RESERVED = new Set(["function", "var", "class", "new", "return", "delete", "in", "of", "if", "else", "let", "const", "default", "enum"]);
const tsIdent = (n: string): string => (TS_RESERVED.has(n) ? n + "_" : n);

function interfaceDecl(name: string): string {
  const def = ctx.structs.get(name)!;
  const lines = def.fields.map((f) => {
    // Flat structs only contain scalar and nested-scalar fields (no arrays/pointers).
    const t = resolveType(f.type, ctx);
    const ts = t.base.t === "prim" ? PRIM_TS[t.base.prim] : t.base.name;
    return `  ${tsIdent(f.name)}: ${ts};`;
  });
  return `export interface ${name} {\n${lines.join("\n")}\n}`;
}

function readerFn(name: string): string {
  const def = ctx.structs.get(name)!;
  const expr = readerExpr(def, "__dv");
  return [
    `export function __read_${name}(__b: Uint8Array): ${name} {`,
    `  const __dv = new DataView(__b.buffer, __b.byteOffset, __b.byteLength);`,
    `  return ${expr};`,
    `}`,
  ].join("\n");
}

function readerExpr(def: StructDef, dv: string): string {
  // Walk fields with running offsets (flat structs only contain scalar and nested-scalar fields).
  const chunks: string[] = [];
  let offset = 0;
  for (const f of def.fields) {
    const t = resolveType(f.type, ctx);
    const lay = t.base.t === "struct" ? layoutStruct(t.base.name) : null;
    const fieldAlign = t.base.t === "prim" ? PRIM_SIZE[t.base.prim] : lay ? lay.align : 8;
    offset = alignUp(offset, fieldAlign);
    if (t.base.t === "prim") {
      const p = t.base.prim;
      const read = p === "bool"
        ? `(${dv}.getUint8(${offset}) !== 0)`
        : (p === "i8" || p === "u8")
          ? `${dv}.${PRIM_DV[p]}(${offset})`
          : `${dv}.${PRIM_DV[p]}(${offset}, true)`;
      chunks.push(`${tsIdent(f.name)}: ${read}`);
      offset += PRIM_SIZE[p];
    } else {
      const sub = ctx.structs.get(t.base.name)!;
      // Recursion needs absolute offsets — build a shifted DataView view instead.
      chunks.push(`${tsIdent(f.name)}: __read_${t.base.name}(new Uint8Array(__b.buffer, __b.byteOffset + ${offset}, ${lay!.size}))`);
      offset += lay!.size;
    }
  }
  return `{ ${chunks.join(", ")} }`;
}

// ---------------------------------------------------------------------------
// Emit everything
// ---------------------------------------------------------------------------

function main(): void {
  const src = readFileSync(headerPath, "utf8");
  ctx = { structs: new Map(), structNames: new Set(), aliases: new Map(), fnptrs: new Set() };
  enums.length = 0;
  functions.length = 0;
  layoutMemo.clear();
  parseHeader(src, ctx);

  const plans = functions.map((fn) => ({ fn, plan: classify(fn) }));

  const bound = plans.filter((p) => p.plan.k !== "skip");
  const skipped = plans.filter((p) => p.plan.k === "skip") as Array<{ fn: RawFn; plan: Extract<FnPlan, { k: "skip" }> }>;

  // ---------- raylib_ffi.json ----------
  const manifest = {
    ffi_format: 6,
    functions: bound.map(({ plan }) => {
      if (plan.k === "direct") {
        return { name: plan.tsName, symbol: plan.symbol, params: plan.params.map((p) => p.cls), returns: plan.ret };
      }
      return {
        name: plan.tsName, symbol: plan.symbol,
        params: plan.manifestParams,
        returns: plan.ret.k === "scalar" ? primClass(plan.ret.prim) : "void",
      };
    }),
    libraries: ["./libraylib_shim.a"],
    system_libraries: ["raylib"],
  };

  // ---------- raylib_shim.c ----------
  const shim: string[] = [];
  shim.push(`/* Generated by tools/gen_bindings.ts — do not edit. */`);
  shim.push(`#include <stddef.h>`, `#include <stdint.h>`, `#include <stdlib.h>`, `#include <string.h>`, `#include "raylib.h"`, ``);
  shim.push(`/* Layout checks: generated DataView offsets in raylib.ts must match the C compiler. */`);
  for (const name of ctx.structs.keys()) {
    const def = ctx.structs.get(name)!;
    if (def.fields.length === 0) continue; // opaque forwards
    shim.push(`_Static_assert(sizeof(${name}) == ${layoutStruct(name).size}, "layout mismatch: ${name}");`);
  }
  shim.push(``);
  for (const { fn, plan } of bound) {
    if (plan.k !== "wrap") continue;
    shim.push(`void ${plan.symbol}(${plan.cParams.join(", ")}) {`);
    for (const line of plan.cBody) shim.push(`    ${line}`);
    shim.push(`}`, ``);
  }
  const shimC = shim.join("\n");

  // ---------- raylib_ffi.ts ----------
  const decls: string[] = [];
  decls.push(`/* Generated by tools/gen_bindings.ts — do not edit. */`);
  decls.push(`/* Raw scriptc FFI bindings. Every function is declared signature-only;`);
  decls.push(`   implementations come from gen/raylib_ffi.json at link time. */`);
  decls.push(``);
  for (const { plan } of bound) {
    // Declarations must match the manifest ABI exactly: flattened structs
    // appear as individual scalar params (same naming as the C shim).
    const params: string[] = [];
    if (plan.k === "direct") {
      plan.params.forEach((p, i) => params.push(`a${i}: ${p.ts}`));
    } else {
      for (const p of plan.params) {
        if (p.k === "scalar") params.push(`${p.name}: ${PRIM_TS[p.prim]}`);
        else if (p.k === "string") params.push(`${p.name}: string`);
        else if (p.k === "bytes" || p.k === "opaque") params.push(`${p.name}: Uint8Array`);
        else for (const leaf of p.leaves) params.push(`${p.name}_${leaf.path.join("_")}: ${PRIM_TS[leaf.prim]}`);
      }
      if (plan.ret.k === "struct-out") params.push("__out: Uint8Array");
    }
    const ret = plan.k === "direct" ? plan.retTs : plan.ret.k === "scalar" ? PRIM_TS[plan.ret.prim] : "void";
    decls.push(`export declare function ${plan.tsName}(${params.join(", ")}): ${ret};`);
  }
  const ffiTs = decls.join("\n");

  // ---------- raylib.ts ----------
  const api: string[] = [];
  api.push(`/* Generated by tools/gen_bindings.ts — do not edit. */`);
  api.push(`/* Typed raylib bindings for scriptc. Opaque handle types are Uint8Array`);
  api.push(`   byte buffers: pass the SAME buffer back to native calls, never copy it. */`);
  api.push(``);
  api.push(`import {`);
  for (const { plan } of bound) api.push(`  ${plan.tsName},`);
  api.push(`} from "./raylib_ffi";`);
  api.push(``);
  for (const e of enums) {
    for (const v of e.values) api.push(`export const ${v.name} = ${v.value};`);
  }
  api.push(``);
  for (const name of ctx.structs.keys()) {
    const def = ctx.structs.get(name)!;
    if (def.fields.length === 0) continue;
    const lay = layoutStruct(name);
    if (lay.flat && !ctx.aliases.has(name)) api.push(interfaceDecl(name));
    else if (!ctx.aliases.has(name)) api.push(`export type ${name} = Uint8Array;`);
  }
  for (const [alias, { target }] of ctx.aliases) {
    if (alias === "ModelAnimPose") continue; // pointer alias — internal
    api.push(`export type ${alias} = ${target};`);
  }
  api.push(``);
  for (const name of ctx.structs.keys()) {
    const def = ctx.structs.get(name)!;
    if (def.fields.length === 0) continue;
    const lay = layoutStruct(name);
    if (lay.flat && !ctx.aliases.has(name)) api.push(readerFn(name));
  }
  api.push(``);
  for (const { fn, plan } of bound) {
    if (plan.k === "direct") {
      const args = plan.params.map((_, i) => `a${i}`).join(", ");
      const ret = plan.retTs === "void" ? "" : `: ${plan.retTs}`;
      const body = plan.ret === "void" ? `rl_${fn.name}(${args});` : `return rl_${fn.name}(${args});`;
      api.push(`export function ${fn.name}(${plan.params.map((p, i) => `a${i}: ${p.ts}`).join(", ")})${ret} {`);
      api.push(`  ${body}`);
      api.push(`}`);
      api.push(``);
      continue;
    }
    // Map TS argument expressions per param kind.
    const callArgs: string[] = [];
    for (const p of plan.params) {
      const name = tsIdent(p.name);
      if (p.k !== "flat") {
        callArgs.push(name);
      } else {
        for (const leaf of p.leaves) callArgs.push(`${name}.${leaf.path.join(".")}`);
      }
    }
    if (plan.ret.k === "struct-out") callArgs.push("__buf");
    const paramsText = plan.tsParams
      .filter((p) => p.name !== "__out")
      .map((p) => `${tsIdent(p.name)}: ${p.ts}`)
      .join(", ");
    const retType = plan.ret.k === "scalar" ? `: ${PRIM_TS[plan.ret.prim]}` : plan.ret.k === "struct-out" ? `: ${plan.ret.structName}` : ": void";
    api.push(`export function ${fn.name}(${paramsText})${retType} {`);
    if (plan.ret.k === "struct-out") {
      api.push(`  const __buf = new Uint8Array(${plan.ret.size});`);
      api.push(`  ${plan.tsName}(${callArgs.join(", ")});`);
      api.push(`  return ${plan.ret.k === "struct-out" && layoutStruct(plan.ret.structName).flat ? `__read_${plan.ret.structName}(__buf)` : "__buf"};`);
    } else if (plan.ret.k === "scalar") {
      api.push(`  return ${plan.tsName}(${callArgs.join(", ")});`);
    } else {
      api.push(`  ${plan.tsName}(${callArgs.join(", ")});`);
    }
    api.push(`}`);
    api.push(``);
  }
  api.push(`export const Raylib = {`);
  for (const { fn } of bound) {
    const camel = fn.name.charAt(0).toLowerCase() + fn.name.slice(1);
    api.push(`  ${fn.name},`);
    if (camel !== fn.name) {
      api.push(`  ${camel}: ${fn.name},`);
    }
  }
  api.push(`};`);
  api.push(``);
  const apiTs = api.join("\n");

  // ---------- write ----------
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "raylib_ffi.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(outDir, "raylib_shim.c"), shimC + "\n");
  writeFileSync(join(outDir, "raylib_ffi.ts"), ffiTs + "\n");
  writeFileSync(join(outDir, "raylib.ts"), apiTs + "\n");

  // ---------- summary ----------
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.plan.reason, (byReason.get(s.plan.reason) ?? 0) + 1);
  console.log(`functions: ${functions.length} total`);
  console.log(`  direct:  ${bound.filter((b) => b.plan.k === "direct").length}`);
  console.log(`  wrapped: ${bound.filter((b) => b.plan.k === "wrap").length}`);
  console.log(`  skipped: ${skipped.length}`);
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason}: ${n}`);
  }
  console.log(`structs: ${ctx.structs.size} (${[...ctx.structs.keys()].filter((n) => layoutStruct(n).flat).length} flattenable)`);
  console.log(`enums:   ${enums.length}`);
}

main();
