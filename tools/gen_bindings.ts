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
  /^ExportImageAsCode$/, /^ExportDataAsCode$/, /^ExportMesh$/,
  /^LoadAutomationEventList$/, /^ExportAutomationEvents$/, /^SetAutomationEventList$/, /^SetAutomationEventBase$/,
];
// Manual memory management from script land makes no sense.
const SKIP_MEMORY = [/^MemAlloc$/, /^MemRealloc$/, /^MemFree$/];

type ParamPlan =
  | { k: "scalar"; name: string; prim: Prim }
  | { k: "string"; name: string }
  | { k: "bytes"; name: string }
  | { k: "flat"; name: string; structName: string; leaves: Leaf[] }
  | { k: "opaque"; name: string; structName: string; size: number }
  | { k: "mutable-opaque"; name: string; structName: string; size: number };

type RetPlan = { k: "void" } | { k: "scalar"; prim: Prim } | { k: "struct-out"; structName: string; size: number };

type FnPlan =
  | { k: "direct"; tsName: string; symbol: string; params: Array<{ cls: string; ts: string }>; ret: string; retTs: string }
  | {
      k: "wrap"; tsName: string; symbol: string; params: ParamPlan[]; ret: RetPlan;
      cParams: string[]; cBody: string[]; cCall: string; manifestParams: string[]; tsParams: Array<{ name: string; ts: string }>;
    }
  | {
      k: "custom"; tsName: string; symbol: string;
      manifestParams: string[]; manifestRet: string;
      cCode: string; ffiDecl: string; apiCode: string;
    }
  | { k: "skip"; reason: string };

function primClass(p: Prim): string { return p === "bool" ? "bool" : p; }

function makeSplineHandler(name: string): () => Extract<FnPlan, { k: "custom" }> {
  return () => ({
    k: "custom",
    tsName: `rl_${name}`,
    symbol: `rl_${name}`,
    manifestParams: ["bytes", "i32", "f32", "u8", "u8", "u8", "u8"],
    manifestRet: "void",
    cCode: `void rl_${name}(const uint8_t *points_ptr, size_t points_len, int32_t pointCount, float thick, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    ${name}((const Vector2 *)points_ptr, pointCount, thick, (Color){ r, g, b, a });
}`,
    ffiDecl: `export declare function rl_${name}(points: Uint8Array, pointCount: number, thick: number, r: number, g: number, b: number, a: number): void;`,
    apiCode: `export function ${name}(points: Float32Array | Uint8Array | Vector2[], thick: number, color: Color, pointCount?: number): void {
  const [__b, __cnt] = __toVector2Bytes(points);
  rl_${name}(__b, pointCount !== undefined ? pointCount : __cnt, thick, color.r, color.g, color.b, color.a);
}`,
  });
}

const CUSTOM_HANDLERS: Record<string, () => Extract<FnPlan, { k: "custom" }>> = {
  DrawLineStrip: () => ({
    k: "custom",
    tsName: "rl_DrawLineStrip",
    symbol: "rl_DrawLineStrip",
    manifestParams: ["bytes", "i32", "u8", "u8", "u8", "u8"],
    manifestRet: "void",
    cCode: `void rl_DrawLineStrip(const uint8_t *points_ptr, size_t points_len, int32_t pointCount, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    DrawLineStrip((const Vector2 *)points_ptr, pointCount, (Color){ r, g, b, a });
}`,
    ffiDecl: `export declare function rl_DrawLineStrip(points: Uint8Array, pointCount: number, r: number, g: number, b: number, a: number): void;`,
    apiCode: `export function DrawLineStrip(points: Float32Array | Uint8Array | Vector2[], color: Color, pointCount?: number): void {
  const [__b, __cnt] = __toVector2Bytes(points);
  rl_DrawLineStrip(__b, pointCount !== undefined ? pointCount : __cnt, color.r, color.g, color.b, color.a);
}`,
  }),
  DrawTriangleFan: () => ({
    k: "custom",
    tsName: "rl_DrawTriangleFan",
    symbol: "rl_DrawTriangleFan",
    manifestParams: ["bytes", "i32", "u8", "u8", "u8", "u8"],
    manifestRet: "void",
    cCode: `void rl_DrawTriangleFan(const uint8_t *points_ptr, size_t points_len, int32_t pointCount, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    DrawTriangleFan((const Vector2 *)points_ptr, pointCount, (Color){ r, g, b, a });
}`,
    ffiDecl: `export declare function rl_DrawTriangleFan(points: Uint8Array, pointCount: number, r: number, g: number, b: number, a: number): void;`,
    apiCode: `export function DrawTriangleFan(points: Float32Array | Uint8Array | Vector2[], color: Color, pointCount?: number): void {
  const [__b, __cnt] = __toVector2Bytes(points);
  rl_DrawTriangleFan(__b, pointCount !== undefined ? pointCount : __cnt, color.r, color.g, color.b, color.a);
}`,
  }),
  DrawTriangleStrip: () => ({
    k: "custom",
    tsName: "rl_DrawTriangleStrip",
    symbol: "rl_DrawTriangleStrip",
    manifestParams: ["bytes", "i32", "u8", "u8", "u8", "u8"],
    manifestRet: "void",
    cCode: `void rl_DrawTriangleStrip(const uint8_t *points_ptr, size_t points_len, int32_t pointCount, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    DrawTriangleStrip((const Vector2 *)points_ptr, pointCount, (Color){ r, g, b, a });
}`,
    ffiDecl: `export declare function rl_DrawTriangleStrip(points: Uint8Array, pointCount: number, r: number, g: number, b: number, a: number): void;`,
    apiCode: `export function DrawTriangleStrip(points: Float32Array | Uint8Array | Vector2[], color: Color, pointCount?: number): void {
  const [__b, __cnt] = __toVector2Bytes(points);
  rl_DrawTriangleStrip(__b, pointCount !== undefined ? pointCount : __cnt, color.r, color.g, color.b, color.a);
}`,
  }),
  DrawTriangleStrip3D: () => ({
    k: "custom",
    tsName: "rl_DrawTriangleStrip3D",
    symbol: "rl_DrawTriangleStrip3D",
    manifestParams: ["bytes", "i32", "u8", "u8", "u8", "u8"],
    manifestRet: "void",
    cCode: `void rl_DrawTriangleStrip3D(const uint8_t *points_ptr, size_t points_len, int32_t pointCount, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    DrawTriangleStrip3D((const Vector3 *)points_ptr, pointCount, (Color){ r, g, b, a });
}`,
    ffiDecl: `export declare function rl_DrawTriangleStrip3D(points: Uint8Array, pointCount: number, r: number, g: number, b: number, a: number): void;`,
    apiCode: `export function DrawTriangleStrip3D(points: Float32Array | Uint8Array | Vector3[], color: Color, pointCount?: number): void {
  const [__b, __cnt] = __toVector3Bytes(points);
  rl_DrawTriangleStrip3D(__b, pointCount !== undefined ? pointCount : __cnt, color.r, color.g, color.b, color.a);
}`,
  }),
  DrawSplineLinear: makeSplineHandler("DrawSplineLinear"),
  DrawSplineBasis: makeSplineHandler("DrawSplineBasis"),
  DrawSplineCatmullRom: makeSplineHandler("DrawSplineCatmullRom"),
  DrawSplineBezierQuadratic: makeSplineHandler("DrawSplineBezierQuadratic"),
  DrawSplineBezierCubic: makeSplineHandler("DrawSplineBezierCubic"),
  GetMonitorName: () => ({
    k: "custom",
    tsName: "rl_GetMonitorName",
    symbol: "rl_GetMonitorName",
    manifestParams: ["i32", "mutable-bytes"],
    manifestRet: "i32",
    cCode: `int32_t rl_GetMonitorName(int32_t monitor, uint8_t *out, size_t out_len) {
    const char *s = GetMonitorName(monitor);
    if (s == NULL) return 0;
    size_t len = strlen(s);
    if (out != NULL && out_len > 0) {
        size_t c = len < out_len ? len : out_len;
        memcpy(out, s, c);
    }
    return (int32_t)len;
}`,
    ffiDecl: `export declare function rl_GetMonitorName(monitor: number, __out: Uint8Array): number;`,
    apiCode: `export function GetMonitorName(monitor: number): string {
  const __buf = new Uint8Array(256);
  const __len = rl_GetMonitorName(monitor, __buf);
  if (__len <= 0) return "";
  return new TextDecoder().decode(__buf.subarray(0, Math.min(__len, 256)));
}`,
  }),
  GetClipboardText: () => ({
    k: "custom",
    tsName: "rl_GetClipboardText",
    symbol: "rl_GetClipboardText",
    manifestParams: ["mutable-bytes"],
    manifestRet: "i32",
    cCode: `int32_t rl_GetClipboardText(uint8_t *out, size_t out_len) {
    const char *s = GetClipboardText();
    if (s == NULL) return 0;
    size_t len = strlen(s);
    if (out != NULL && out_len > 0) {
        size_t c = len < out_len ? len : out_len;
        memcpy(out, s, c);
    }
    return (int32_t)len;
}`,
    ffiDecl: `export declare function rl_GetClipboardText(__out: Uint8Array): number;`,
    apiCode: `export function GetClipboardText(): string {
  const __buf = new Uint8Array(1024);
  const __len = rl_GetClipboardText(__buf);
  if (__len <= 0) return "";
  if (__len <= __buf.length) return new TextDecoder().decode(__buf.subarray(0, __len));
  const __big = new Uint8Array(__len);
  rl_GetClipboardText(__big);
  return new TextDecoder().decode(__big);
}`,
  }),
  GetGamepadName: () => ({
    k: "custom",
    tsName: "rl_GetGamepadName",
    symbol: "rl_GetGamepadName",
    manifestParams: ["i32", "mutable-bytes"],
    manifestRet: "i32",
    cCode: `int32_t rl_GetGamepadName(int32_t gamepad, uint8_t *out, size_t out_len) {
    const char *s = GetGamepadName(gamepad);
    if (s == NULL) return 0;
    size_t len = strlen(s);
    if (out != NULL && out_len > 0) {
        size_t c = len < out_len ? len : out_len;
        memcpy(out, s, c);
    }
    return (int32_t)len;
}`,
    ffiDecl: `export declare function rl_GetGamepadName(gamepad: number, __out: Uint8Array): number;`,
    apiCode: `export function GetGamepadName(gamepad: number): string {
  const __buf = new Uint8Array(256);
  const __len = rl_GetGamepadName(gamepad, __buf);
  if (__len <= 0) return "";
  return new TextDecoder().decode(__buf.subarray(0, Math.min(__len, 256)));
}`,
  }),
  LoadFontEx: () => ({
    k: "custom",
    tsName: "rl_LoadFontEx",
    symbol: "rl_LoadFontEx",
    manifestParams: ["string", "i32", "bytes", "i32", "mutable-bytes"],
    manifestRet: "void",
    cCode: `void rl_LoadFontEx(const uint8_t *fileName_ptr, size_t fileName_len, int32_t fontSize, const uint8_t *codepoints_ptr, size_t codepoints_len, int32_t codepointCount, uint8_t *out, size_t out_len) {
    if (out_len != (size_t)sizeof(Font)) return;
    char *fileName_buf = (char *)malloc(fileName_len + 1);
    if (fileName_buf == NULL) return;
    memcpy(fileName_buf, fileName_ptr, fileName_len);
    fileName_buf[fileName_len] = '\\0';
    int *cp = (codepointCount > 0 && codepoints_ptr != NULL) ? (int *)codepoints_ptr : NULL;
    Font __v = LoadFontEx((const char *)fileName_buf, fontSize, cp, codepointCount);
    free(fileName_buf);
    memcpy(out, &__v, sizeof(__v));
}`,
    ffiDecl: `export declare function rl_LoadFontEx(fileName: string, fontSize: number, codepoints: Uint8Array, codepointCount: number, __out: Uint8Array): void;`,
    apiCode: `export function LoadFontEx(fileName: string, fontSize: number, codepoints?: Int32Array | null, codepointCount?: number): Font {
  const __buf = new Uint8Array(48);
  const cpBytes = codepoints ? new Uint8Array(codepoints.buffer, codepoints.byteOffset, codepoints.byteLength) : new Uint8Array(0);
  const count = codepointCount !== undefined ? codepointCount : (codepoints ? codepoints.length : 0);
  rl_LoadFontEx(fileName, fontSize, cpBytes, count, __buf);
  return __buf;
}`,
  }),
  GetCodepoint: () => ({
    k: "custom",
    tsName: "rl_GetCodepoint",
    symbol: "rl_GetCodepoint",
    manifestParams: ["string", "mutable-bytes"],
    manifestRet: "i32",
    cCode: `int32_t rl_GetCodepoint(const uint8_t *text_ptr, size_t text_len, uint8_t *size_out, size_t size_out_len) {
    char *text_buf = (char *)malloc(text_len + 1);
    if (text_buf == NULL) return 0;
    memcpy(text_buf, text_ptr, text_len);
    text_buf[text_len] = '\\0';
    int size = 0;
    int cp = GetCodepoint(text_buf, &size);
    free(text_buf);
    if (size_out != NULL && size_out_len >= 4) {
        memcpy(size_out, &size, 4);
    }
    return cp;
}`,
    ffiDecl: `export declare function rl_GetCodepoint(text: string, __size_out: Uint8Array): number;`,
    apiCode: `export function GetCodepoint(text: string): { codepoint: number; size: number } {
  const sizeBuf = new Uint8Array(4);
  const cp = rl_GetCodepoint(text, sizeBuf);
  const dv = new DataView(sizeBuf.buffer, sizeBuf.byteOffset, 4);
  return { codepoint: cp, size: dv.getInt32(0, true) };
}`,
  }),
  GetCodepointNext: () => ({
    k: "custom",
    tsName: "rl_GetCodepointNext",
    symbol: "rl_GetCodepointNext",
    manifestParams: ["string", "mutable-bytes"],
    manifestRet: "i32",
    cCode: `int32_t rl_GetCodepointNext(const uint8_t *text_ptr, size_t text_len, uint8_t *size_out, size_t size_out_len) {
    char *text_buf = (char *)malloc(text_len + 1);
    if (text_buf == NULL) return 0;
    memcpy(text_buf, text_ptr, text_len);
    text_buf[text_len] = '\\0';
    int size = 0;
    int cp = GetCodepointNext(text_buf, &size);
    free(text_buf);
    if (size_out != NULL && size_out_len >= 4) {
        memcpy(size_out, &size, 4);
    }
    return cp;
}`,
    ffiDecl: `export declare function rl_GetCodepointNext(text: string, __size_out: Uint8Array): number;`,
    apiCode: `export function GetCodepointNext(text: string): { codepoint: number; size: number } {
  const sizeBuf = new Uint8Array(4);
  const cp = rl_GetCodepointNext(text, sizeBuf);
  const dv = new DataView(sizeBuf.buffer, sizeBuf.byteOffset, 4);
  return { codepoint: cp, size: dv.getInt32(0, true) };
}`,
  }),
  GetCodepointPrevious: () => ({
    k: "custom",
    tsName: "rl_GetCodepointPrevious",
    symbol: "rl_GetCodepointPrevious",
    manifestParams: ["string", "mutable-bytes"],
    manifestRet: "i32",
    cCode: `int32_t rl_GetCodepointPrevious(const uint8_t *text_ptr, size_t text_len, uint8_t *size_out, size_t size_out_len) {
    char *text_buf = (char *)malloc(text_len + 1);
    if (text_buf == NULL) return 0;
    memcpy(text_buf, text_ptr, text_len);
    text_buf[text_len] = '\\0';
    int size = 0;
    int cp = GetCodepointPrevious(text_buf, &size);
    free(text_buf);
    if (size_out != NULL && size_out_len >= 4) {
        memcpy(size_out, &size, 4);
    }
    return cp;
}`,
    ffiDecl: `export declare function rl_GetCodepointPrevious(text: string, __size_out: Uint8Array): number;`,
    apiCode: `export function GetCodepointPrevious(text: string): { codepoint: number; size: number } {
  const sizeBuf = new Uint8Array(4);
  const cp = rl_GetCodepointPrevious(text, sizeBuf);
  const dv = new DataView(sizeBuf.buffer, sizeBuf.byteOffset, 4);
  return { codepoint: cp, size: dv.getInt32(0, true) };
}`,
  }),
  LoadShader: () => ({
    k: "custom",
    tsName: "rl_LoadShader",
    symbol: "rl_LoadShader",
    manifestParams: ["string", "string", "mutable-bytes"],
    manifestRet: "void",
    cCode: `void rl_LoadShader(const uint8_t *vsFileName_ptr, size_t vsFileName_len, const uint8_t *fsFileName_ptr, size_t fsFileName_len, uint8_t *out, size_t out_len) {
    if (out_len != (size_t)sizeof(Shader)) return;
    char *vs_buf = NULL;
    if (vsFileName_len > 0) {
        vs_buf = (char *)malloc(vsFileName_len + 1);
        if (vs_buf) { memcpy(vs_buf, vsFileName_ptr, vsFileName_len); vs_buf[vsFileName_len] = '\\0'; }
    }
    char *fs_buf = NULL;
    if (fsFileName_len > 0) {
        fs_buf = (char *)malloc(fsFileName_len + 1);
        if (fs_buf) { memcpy(fs_buf, fsFileName_ptr, fsFileName_len); fs_buf[fsFileName_len] = '\\0'; }
    }
    Shader __v = LoadShader(vs_buf, fs_buf);
    if (vs_buf) free(vs_buf);
    if (fs_buf) free(fs_buf);
    memcpy(out, &__v, sizeof(__v));
}`,
    ffiDecl: `export declare function rl_LoadShader(vsFileName: string, fsFileName: string, __out: Uint8Array): void;`,
    apiCode: `export function LoadShader(vsFileName?: string | null, fsFileName?: string | null): Shader {
  const __buf = new Uint8Array(16);
  rl_LoadShader(vsFileName ?? "", fsFileName ?? "", __buf);
  return __buf;
}`,
  }),
  LoadShaderFromMemory: () => ({
    k: "custom",
    tsName: "rl_LoadShaderFromMemory",
    symbol: "rl_LoadShaderFromMemory",
    manifestParams: ["string", "string", "mutable-bytes"],
    manifestRet: "void",
    cCode: `void rl_LoadShaderFromMemory(const uint8_t *vsCode_ptr, size_t vsCode_len, const uint8_t *fsCode_ptr, size_t fsCode_len, uint8_t *out, size_t out_len) {
    if (out_len != (size_t)sizeof(Shader)) return;
    char *vs_buf = NULL;
    if (vsCode_len > 0) {
        vs_buf = (char *)malloc(vsCode_len + 1);
        if (vs_buf) { memcpy(vs_buf, vsCode_ptr, vsCode_len); vs_buf[vsCode_len] = '\\0'; }
    }
    char *fs_buf = NULL;
    if (fsCode_len > 0) {
        fs_buf = (char *)malloc(fsCode_len + 1);
        if (fs_buf) { memcpy(fs_buf, fsCode_ptr, fsCode_len); fs_buf[fsCode_len] = '\\0'; }
    }
    Shader __v = LoadShaderFromMemory(vs_buf, fs_buf);
    if (vs_buf) free(vs_buf);
    if (fs_buf) free(fs_buf);
    memcpy(out, &__v, sizeof(__v));
}`,
    ffiDecl: `export declare function rl_LoadShaderFromMemory(vsCode: string, fsCode: string, __out: Uint8Array): void;`,
    apiCode: `export function LoadShaderFromMemory(vsCode?: string | null, fsCode?: string | null): Shader {
  const __buf = new Uint8Array(16);
  rl_LoadShaderFromMemory(vsCode ?? "", fsCode ?? "", __buf);
  return __buf;
}`,
  }),
  GetGlyphInfo: () => ({
    k: "custom",
    tsName: "rl_GetGlyphInfo",
    symbol: "rl_GetGlyphInfo",
    manifestParams: ["bytes", "i32", "mutable-bytes"],
    manifestRet: "void",
    cCode: `void rl_GetGlyphInfo(const uint8_t *font_ptr, size_t font_len, int32_t codepoint, uint8_t *out, size_t out_len) {
    if (out_len != (size_t)sizeof(GlyphInfo)) return;
    if (font_len != (size_t)sizeof(Font)) return;
    Font font;
    memcpy(&font, font_ptr, sizeof(font));
    GlyphInfo __v = GetGlyphInfo(font, codepoint);
    memcpy(out, &__v, sizeof(__v));
}`,
    ffiDecl: `export declare function rl_GetGlyphInfo(font: Uint8Array, codepoint: number, __out: Uint8Array): void;`,
    apiCode: `export function GetGlyphInfo(font: Font, codepoint: number): GlyphInfo {
  const __buf = new Uint8Array(40);
  rl_GetGlyphInfo(font, codepoint, __buf);
  return __read_GlyphInfo(__buf);
}`,
  }),
  DrawCircleGradient: () => ({
    k: "custom",
    tsName: "rl_DrawCircleGradient",
    symbol: "rl_DrawCircleGradient",
    manifestParams: ["f32", "f32", "f32", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8"],
    manifestRet: "void",
    cCode: `void rl_DrawCircleGradient(float center_x, float center_y, float radius, uint8_t inner_r, uint8_t inner_g, uint8_t inner_b, uint8_t inner_a, uint8_t outer_r, uint8_t outer_g, uint8_t outer_b, uint8_t outer_a) {
    DrawCircleGradient((Vector2){ center_x, center_y }, radius, (Color){ inner_r, inner_g, inner_b, inner_a }, (Color){ outer_r, outer_g, outer_b, outer_a });
}`,
    ffiDecl: `export declare function rl_DrawCircleGradient(center_x: number, center_y: number, radius: number, inner_r: number, inner_g: number, inner_b: number, inner_a: number, outer_r: number, outer_g: number, outer_b: number, outer_a: number): void;`,
    apiCode: `export function DrawCircleGradient(a: Vector2 | number, b: number, c: number | Color, d?: Color, e?: Color): void {
  if (typeof a === "object") {
    rl_DrawCircleGradient((a as Vector2).x, (a as Vector2).y, b, (c as Color).r, (c as Color).g, (c as Color).b, (c as Color).a, d!.r, d!.g, d!.b, d!.a);
  } else {
    rl_DrawCircleGradient(a as number, b, c as number, d!.r, d!.g, d!.b, d!.a, e!.r, e!.g, e!.b, e!.a);
  }
}`,
  }),
  UpdateCamera: () => ({
    k: "custom",
    tsName: "rl_UpdateCamera",
    symbol: "rl_UpdateCamera",
    manifestParams: ["mutable-bytes", "i32"],
    manifestRet: "void",
    cCode: `void rl_UpdateCamera(uint8_t *cam_ptr, size_t cam_len, int32_t mode) {
    if (cam_len != (size_t)sizeof(Camera3D)) return;
    Camera3D cam;
    memcpy(&cam, cam_ptr, sizeof(Camera3D));
    UpdateCamera(&cam, mode);
    memcpy(cam_ptr, &cam, sizeof(Camera3D));
}`,
    ffiDecl: `export declare function rl_UpdateCamera(cam: Uint8Array, mode: number): void;`,
    apiCode: `export function UpdateCamera(camera: Camera3D, mode: number): Camera3D {
  const __buf = new Uint8Array(44);
  const __dv = new DataView(__buf.buffer, __buf.byteOffset, 44);
  __dv.setFloat32(0, camera.position.x, true);
  __dv.setFloat32(4, camera.position.y, true);
  __dv.setFloat32(8, camera.position.z, true);
  __dv.setFloat32(12, camera.target.x, true);
  __dv.setFloat32(16, camera.target.y, true);
  __dv.setFloat32(20, camera.target.z, true);
  __dv.setFloat32(24, camera.up.x, true);
  __dv.setFloat32(28, camera.up.y, true);
  __dv.setFloat32(32, camera.up.z, true);
  __dv.setFloat32(36, camera.fovy, true);
  __dv.setInt32(40, camera.projection, true);
  rl_UpdateCamera(__buf, mode);
  const updated = __read_Camera3D(__buf);
  camera.position.x = updated.position.x;
  camera.position.y = updated.position.y;
  camera.position.z = updated.position.z;
  camera.target.x = updated.target.x;
  camera.target.y = updated.target.y;
  camera.target.z = updated.target.z;
  camera.up.x = updated.up.x;
  camera.up.y = updated.up.y;
  camera.up.z = updated.up.z;
  camera.fovy = updated.fovy;
  camera.projection = updated.projection;
  return camera;
}`,
  }),
  UpdateCameraPro: () => ({
    k: "custom",
    tsName: "rl_UpdateCameraPro",
    symbol: "rl_UpdateCameraPro",
    manifestParams: ["mutable-bytes", "f32", "f32", "f32", "f32", "f32", "f32", "f32"],
    manifestRet: "void",
    cCode: `void rl_UpdateCameraPro(uint8_t *cam_ptr, size_t cam_len, float mov_x, float mov_y, float mov_z, float rot_x, float rot_y, float rot_z, float zoom) {
    if (cam_len != (size_t)sizeof(Camera3D)) return;
    Camera3D cam;
    memcpy(&cam, cam_ptr, sizeof(Camera3D));
    UpdateCameraPro(&cam, (Vector3){ mov_x, mov_y, mov_z }, (Vector3){ rot_x, rot_y, rot_z }, zoom);
    memcpy(cam_ptr, &cam, sizeof(Camera3D));
}`,
    ffiDecl: `export declare function rl_UpdateCameraPro(cam: Uint8Array, mov_x: number, mov_y: number, mov_z: number, rot_x: number, rot_y: number, rot_z: number, zoom: number): void;`,
    apiCode: `export function UpdateCameraPro(camera: Camera3D, movement: Vector3, rotation: Vector3, zoom: number): Camera3D {
  const __buf = new Uint8Array(44);
  const __dv = new DataView(__buf.buffer, __buf.byteOffset, 44);
  __dv.setFloat32(0, camera.position.x, true);
  __dv.setFloat32(4, camera.position.y, true);
  __dv.setFloat32(8, camera.position.z, true);
  __dv.setFloat32(12, camera.target.x, true);
  __dv.setFloat32(16, camera.target.y, true);
  __dv.setFloat32(20, camera.target.z, true);
  __dv.setFloat32(24, camera.up.x, true);
  __dv.setFloat32(28, camera.up.y, true);
  __dv.setFloat32(32, camera.up.z, true);
  __dv.setFloat32(36, camera.fovy, true);
  __dv.setInt32(40, camera.projection, true);
  rl_UpdateCameraPro(__buf, movement.x, movement.y, movement.z, rotation.x, rotation.y, rotation.z, zoom);
  const updated = __read_Camera3D(__buf);
  camera.position.x = updated.position.x;
  camera.position.y = updated.position.y;
  camera.position.z = updated.position.z;
  camera.target.x = updated.target.x;
  camera.target.y = updated.target.y;
  camera.target.z = updated.target.z;
  camera.up.x = updated.up.x;
  camera.up.y = updated.up.y;
  camera.up.z = updated.up.z;
  camera.fovy = updated.fovy;
  camera.projection = updated.projection;
  return camera;
}`,
  }),
  CheckCollisionPointPoly: () => ({
    k: "custom",
    tsName: "rl_CheckCollisionPointPoly",
    symbol: "rl_CheckCollisionPointPoly",
    manifestParams: ["f32", "f32", "bytes", "i32"],
    manifestRet: "bool",
    cCode: `bool rl_CheckCollisionPointPoly(float point_x, float point_y, const uint8_t *points_ptr, size_t points_len, int32_t pointCount) {
    return CheckCollisionPointPoly((Vector2){ point_x, point_y }, (const Vector2 *)points_ptr, pointCount);
}`,
    ffiDecl: `export declare function rl_CheckCollisionPointPoly(point_x: number, point_y: number, points: Uint8Array, pointCount: number): boolean;`,
    apiCode: `export function CheckCollisionPointPoly(point: Vector2, points: Float32Array | Uint8Array | Vector2[], pointCount?: number): boolean {
  const [__b, __cnt] = __toVector2Bytes(points);
  return rl_CheckCollisionPointPoly(point.x, point.y, __b, pointCount !== undefined ? pointCount : __cnt);
}`,
  }),
  DrawMeshInstanced: () => ({
    k: "custom",
    tsName: "rl_DrawMeshInstanced",
    symbol: "rl_DrawMeshInstanced",
    manifestParams: ["bytes", "bytes", "bytes", "i32"],
    manifestRet: "void",
    cCode: `static Shader rl_default_instancing_shader = { 0 };
static bool rl_default_instancing_shader_loaded = false;

static void rl_ensure_instancing_shader(void) {
    if (!rl_default_instancing_shader_loaded || !IsShaderValid(rl_default_instancing_shader)) {
        const char *vs = 
            "#version 330\\n"
            "in vec3 vertexPosition;\\n"
            "in vec2 vertexTexCoord;\\n"
            "in vec3 vertexNormal;\\n"
            "in vec4 vertexColor;\\n"
            "in mat4 instanceTransform;\\n"
            "uniform mat4 mvp;\\n"
            "out vec2 fragTexCoord;\\n"
            "out vec4 fragColor;\\n"
            "void main() {\\n"
            "    fragTexCoord = vertexTexCoord;\\n"
            "    fragColor = vertexColor;\\n"
            "    gl_Position = mvp * instanceTransform * vec4(vertexPosition, 1.0);\\n"
            "}\\n";
        const char *fs = 
            "#version 330\\n"
            "in vec2 fragTexCoord;\\n"
            "in vec4 fragColor;\\n"
            "uniform sampler2D texture0;\\n"
            "uniform vec4 colDiffuse;\\n"
            "out vec4 finalColor;\\n"
            "void main() {\\n"
            "    vec4 tex = texture(texture0, fragTexCoord);\\n"
            "    finalColor = tex * colDiffuse * fragColor;\\n"
            "}\\n";
        rl_default_instancing_shader = LoadShaderFromMemory(vs, fs);
        rl_default_instancing_shader.locs[SHADER_LOC_MATRIX_MVP] = GetShaderLocation(rl_default_instancing_shader, "mvp");
        rl_default_instancing_shader.locs[SHADER_LOC_MAP_DIFFUSE] = GetShaderLocation(rl_default_instancing_shader, "texture0");
        rl_default_instancing_shader.locs[SHADER_LOC_VERTEX_INSTANCETRANSFORM] = GetShaderLocationAttrib(rl_default_instancing_shader, "instanceTransform");
        rl_default_instancing_shader_loaded = true;
    }
}

void rl_DrawMeshInstanced(const uint8_t *mesh_ptr, size_t mesh_len, const uint8_t *mat_ptr, size_t mat_len, const uint8_t *transforms_ptr, size_t transforms_len, int32_t instances) {
    if (mesh_len != sizeof(Mesh) || mat_len != sizeof(Material) || instances <= 0) return;
    if (transforms_len < (size_t)instances * sizeof(Matrix)) return;
    Mesh mesh;
    Material mat;
    memcpy(&mesh, mesh_ptr, sizeof(Mesh));
    memcpy(&mat, mat_ptr, sizeof(Material));

    if (!mat.shader.locs || mat.shader.locs[SHADER_LOC_VERTEX_INSTANCETRANSFORM] == -1) {
        rl_ensure_instancing_shader();
        if (IsShaderValid(rl_default_instancing_shader)) {
            mat.shader = rl_default_instancing_shader;
        }
    }
    DrawMeshInstanced(mesh, mat, (const Matrix *)transforms_ptr, instances);
}`,
    ffiDecl: `export declare function rl_DrawMeshInstanced(mesh: Uint8Array, material: Uint8Array, transforms: Uint8Array, instances: number): void;`,
    apiCode: `export function DrawMeshInstanced(mesh: Mesh, material: Material, transforms: Float32Array | Uint8Array | Matrix[], instances?: number): void {
  const [__b, __cnt] = __toMatrixBytes(transforms);
  rl_DrawMeshInstanced(mesh, material, __b, instances !== undefined ? instances : __cnt);
}`,
  }),
  CheckCollisionLines: () => ({
    k: "custom",
    tsName: "rl_CheckCollisionLines",
    symbol: "rl_CheckCollisionLines",
    manifestParams: ["f32", "f32", "f32", "f32", "f32", "f32", "f32", "f32", "mutable-bytes"],
    manifestRet: "bool",
    cCode: `bool rl_CheckCollisionLines(float p1x, float p1y, float p2x, float p2y, float p3x, float p3y, float p4x, float p4y, uint8_t *out_ptr, size_t out_len) {
    Vector2 col = { 0 };
    bool hit = CheckCollisionLines((Vector2){ p1x, p1y }, (Vector2){ p2x, p2y }, (Vector2){ p3x, p3y }, (Vector2){ p4x, p4y }, &col);
    if (out_ptr && out_len >= sizeof(Vector2)) {
        memcpy(out_ptr, &col, sizeof(Vector2));
    }
    return hit;
}`,
    ffiDecl: `export declare function rl_CheckCollisionLines(p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number, p4x: number, p4y: number, __out: Uint8Array): boolean;`,
    apiCode: `export function CheckCollisionLines(startPos1: Vector2, endPos1: Vector2, startPos2: Vector2, endPos2: Vector2): { collision: boolean; point: Vector2 } {
  const __buf = new Uint8Array(8);
  const hit = rl_CheckCollisionLines(startPos1.x, startPos1.y, endPos1.x, endPos1.y, startPos2.x, startPos2.y, endPos2.x, endPos2.y, __buf);
  const __dv = new DataView(__buf.buffer, __buf.byteOffset, 8);
  return { collision: hit, point: { x: __dv.getFloat32(0, true), y: __dv.getFloat32(4, true) } };
}`,
  }),
  LoadImageFromMemory: () => ({
    k: "custom",
    tsName: "rl_LoadImageFromMemory",
    symbol: "rl_LoadImageFromMemory",
    manifestParams: ["string", "bytes", "i32", "mutable-bytes"],
    manifestRet: "void",
    cCode: `void rl_LoadImageFromMemory(const uint8_t *fileType_ptr, size_t fileType_len, const uint8_t *data_ptr, size_t data_len, int32_t dataSize, uint8_t *out, size_t out_len) {
    if (out_len != sizeof(Image)) return;
    char *type_buf = (char *)malloc(fileType_len + 1);
    if (!type_buf) return;
    memcpy(type_buf, fileType_ptr, fileType_len);
    type_buf[fileType_len] = '\\0';
    int size = (dataSize > 0) ? dataSize : (int)data_len;
    Image img = LoadImageFromMemory((const char *)type_buf, (const unsigned char *)data_ptr, size);
    free(type_buf);
    memcpy(out, &img, sizeof(Image));
}`,
    ffiDecl: `export declare function rl_LoadImageFromMemory(fileType: string, fileData: Uint8Array, dataSize: number, __out: Uint8Array): void;`,
    apiCode: `export function LoadImageFromMemory(fileType: string, fileData: Uint8Array, dataSize?: number): Image {
  const __buf = new Uint8Array(24);
  rl_LoadImageFromMemory(fileType, fileData, dataSize !== undefined ? dataSize : fileData.byteLength, __buf);
  return __buf;
}`,
  }),
  LoadWaveFromMemory: () => ({
    k: "custom",
    tsName: "rl_LoadWaveFromMemory",
    symbol: "rl_LoadWaveFromMemory",
    manifestParams: ["string", "bytes", "i32", "mutable-bytes"],
    manifestRet: "void",
    cCode: `void rl_LoadWaveFromMemory(const uint8_t *fileType_ptr, size_t fileType_len, const uint8_t *data_ptr, size_t data_len, int32_t dataSize, uint8_t *out, size_t out_len) {
    if (out_len != sizeof(Wave)) return;
    char *type_buf = (char *)malloc(fileType_len + 1);
    if (!type_buf) return;
    memcpy(type_buf, fileType_ptr, fileType_len);
    type_buf[fileType_len] = '\\0';
    int size = (dataSize > 0) ? dataSize : (int)data_len;
    Wave w = LoadWaveFromMemory((const char *)type_buf, (const unsigned char *)data_ptr, size);
    free(type_buf);
    memcpy(out, &w, sizeof(Wave));
}`,
    ffiDecl: `export declare function rl_LoadWaveFromMemory(fileType: string, fileData: Uint8Array, dataSize: number, __out: Uint8Array): void;`,
    apiCode: `export function LoadWaveFromMemory(fileType: string, fileData: Uint8Array, dataSize?: number): Wave {
  const __buf = new Uint8Array(24);
  rl_LoadWaveFromMemory(fileType, fileData, dataSize !== undefined ? dataSize : fileData.byteLength, __buf);
  return __buf;
}`,
  }),
  LoadMusicStreamFromMemory: () => ({
    k: "custom",
    tsName: "rl_LoadMusicStreamFromMemory",
    symbol: "rl_LoadMusicStreamFromMemory",
    manifestParams: ["string", "bytes", "i32", "mutable-bytes"],
    manifestRet: "void",
    cCode: `void rl_LoadMusicStreamFromMemory(const uint8_t *fileType_ptr, size_t fileType_len, const uint8_t *data_ptr, size_t data_len, int32_t dataSize, uint8_t *out, size_t out_len) {
    if (out_len != sizeof(Music)) return;
    char *type_buf = (char *)malloc(fileType_len + 1);
    if (!type_buf) return;
    memcpy(type_buf, fileType_ptr, fileType_len);
    type_buf[fileType_len] = '\\0';
    int size = (dataSize > 0) ? dataSize : (int)data_len;
    Music m = LoadMusicStreamFromMemory((const char *)type_buf, (const unsigned char *)data_ptr, size);
    free(type_buf);
    memcpy(out, &m, sizeof(Music));
}`,
    ffiDecl: `export declare function rl_LoadMusicStreamFromMemory(fileType: string, data: Uint8Array, dataSize: number, __out: Uint8Array): void;`,
    apiCode: `export function LoadMusicStreamFromMemory(fileType: string, data: Uint8Array, dataSize?: number): Music {
  const __buf = new Uint8Array(56);
  rl_LoadMusicStreamFromMemory(fileType, data, dataSize !== undefined ? dataSize : data.byteLength, __buf);
  return __buf;
}`,
  }),
  LoadModelAnimations: () => ({
    k: "custom",
    tsName: "rl_LoadModelAnimations",
    symbol: "rl_LoadModelAnimations",
    manifestParams: ["string", "mutable-bytes"],
    manifestRet: "i32",
    cCode: `int32_t rl_LoadModelAnimations(const uint8_t *fileName_ptr, size_t fileName_len, uint8_t *out_ptr, size_t out_len) {
    char *name_buf = (char *)malloc(fileName_len + 1);
    if (!name_buf) return 0;
    memcpy(name_buf, fileName_ptr, fileName_len);
    name_buf[fileName_len] = '\\0';
    int count = 0;
    ModelAnimation *anims = LoadModelAnimations(name_buf, &count);
    free(name_buf);
    if (!anims || count <= 0) return 0;
    size_t copyCount = (size_t)count;
    if (copyCount * sizeof(ModelAnimation) > out_len) {
        copyCount = out_len / sizeof(ModelAnimation);
    }
    if (out_ptr && copyCount > 0) {
        memcpy(out_ptr, anims, copyCount * sizeof(ModelAnimation));
    }
    free(anims);
    return (int32_t)copyCount;
}`,
    ffiDecl: `export declare function rl_LoadModelAnimations(fileName: string, __out: Uint8Array): number;`,
    apiCode: `export function LoadModelAnimations(fileName: string): ModelAnimation[] {
  const maxAnims = 256;
  const __buf = new Uint8Array(maxAnims * 48);
  const count = rl_LoadModelAnimations(fileName, __buf);
  const result: ModelAnimation[] = [];
  for (let i = 0; i < count; i++) {
    result.push(new Uint8Array(__buf.buffer, __buf.byteOffset + i * 48, 48));
  }
  return result;
}`,
  }),
  UnloadModelAnimations: () => ({
    k: "custom",
    tsName: "rl_UnloadModelAnimations",
    symbol: "rl_UnloadModelAnimations",
    manifestParams: ["bytes", "i32"],
    manifestRet: "void",
    cCode: `void rl_UnloadModelAnimations(const uint8_t *anims_ptr, size_t anims_len, int32_t count) {
    if (!anims_ptr || count <= 0) return;
    for (int i = 0; i < count; i++) {
        if ((size_t)(i + 1) * sizeof(ModelAnimation) > anims_len) break;
        ModelAnimation *anim = (ModelAnimation *)(anims_ptr + i * sizeof(ModelAnimation));
        if (anim->keyframePoses) {
            for (int k = 0; k < anim->keyframeCount; k++) {
                if (anim->keyframePoses[k]) free(anim->keyframePoses[k]);
            }
            free(anim->keyframePoses);
            anim->keyframePoses = NULL;
        }
    }
}`,
    ffiDecl: `export declare function rl_UnloadModelAnimations(animations: Uint8Array, animCount: number): void;`,
    apiCode: `export function UnloadModelAnimations(animations: ModelAnimation[] | ModelAnimation, animCount?: number): void {
  if (Array.isArray(animations)) {
    for (let i = 0; i < animations.length; i++) {
      rl_UnloadModelAnimations(animations[i]!, 1);
    }
  } else {
    rl_UnloadModelAnimations(animations, animCount !== undefined ? animCount : 1);
  }
}`,
  }),
};

function classify(fn: RawFn): FnPlan {
  if (CUSTOM_HANDLERS[fn.name]) {
    return CUSTOM_HANDLERS[fn.name]();
  }

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
    if (t.ptr === 1 && t.arrLen === undefined && t.base.t === "struct" && !p.type.includes("const")) {
      const lay = layoutStruct(t.base.name);
      if (!lay.flat && t.base.name !== "GlyphInfo") {
        params.push({ k: "mutable-opaque", name: p.name, structName: t.base.name, size: lay.size });
        continue;
      }
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

  const earlyRet = ret.k === "scalar" ? (ret.prim === "bool" ? "return false;" : "return 0;") : "return;";

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
        `if (${p.name}_buf == NULL) ${earlyRet}`,
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
      pre.push(`if (${p.name}_len != (size_t)sizeof(${p.structName})) { ${earlyRet} }`);
      locals.push(`${p.structName} ${p.name};`, `memcpy(&${p.name}, ${p.name}_ptr, sizeof(${p.name}));`);
      callArgs.push(p.name);
    } else if (p.k === "mutable-opaque") {
      cParams.push(`uint8_t *${p.name}_ptr`, `size_t ${p.name}_len`);
      manifestParams.push("mutable-bytes");
      tsParams.push({ name: p.name, ts: p.structName });
      pre.push(`if (${p.name}_len != (size_t)sizeof(${p.structName})) { ${earlyRet} }`);
      callArgs.push(`(${p.structName} *)${p.name}_ptr`);
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
  } else if (ret.k === "scalar") {
    cCall = `${PRIM_C[ret.prim]} __ret = ${fn.name}(${callArgs.join(", ")});`;
    frees.push("return __ret;");
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
    let ts: string;
    if (t.base.t === "prim") ts = PRIM_TS[t.base.prim];
    else if (t.base.t === "struct" || t.base.t === "fnptr" || t.base.t === "unknown") ts = t.base.name;
    else throw new Error(`interface ${name}: field ${f.name} has non-flat type ${f.type}`);
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
    } else if (t.base.t === "struct") {
      // Recursion needs absolute offsets — build a shifted DataView view instead.
      chunks.push(`${tsIdent(f.name)}: __read_${t.base.name}(new Uint8Array(__b.buffer, __b.byteOffset + ${offset}, ${lay!.size}))`);
      offset += lay!.size;
    } else {
      // Only scalar and nested-scalar fields reach the flat-struct path; anything
      // else is handled as an opaque byte buffer instead.
      throw new Error(`struct reader: ${def.name}.${f.name} has non-flat type`);
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

  // Type predicates rather than plain filters: every consumer below reaches for
  // plan.tsName / plan.ret / plan.params without re-checking plan.k.
  type BoundPlan = { fn: RawFn; plan: Exclude<FnPlan, { k: "skip" }> };
  const isBound = (p: { fn: RawFn; plan: FnPlan }): p is BoundPlan => p.plan.k !== "skip";
  const isSkipped = (p: { fn: RawFn; plan: FnPlan }): p is { fn: RawFn; plan: Extract<FnPlan, { k: "skip" }> } =>
    p.plan.k === "skip";

  const bound = plans.filter(isBound);
  const skipped = plans.filter(isSkipped);

  // ---------- raylib_ffi.json ----------
  const manifest = {
    ffi_format: 6,
    functions: bound.map(({ plan }) => {
      if (plan.k === "direct") {
        return { name: plan.tsName, symbol: plan.symbol, params: plan.params.map((p) => p.cls), returns: plan.ret };
      }
      if (plan.k === "custom") {
        return { name: plan.tsName, symbol: plan.symbol, params: plan.manifestParams, returns: plan.manifestRet };
      }
      return {
        name: plan.tsName, symbol: plan.symbol,
        params: plan.manifestParams,
        returns: plan.ret.k === "scalar" ? primClass(plan.ret.prim) : "void",
      };
    }),
    // Portable by design: only the shim archive is named here, with a path
    // relative to this manifest. raylib itself is linked as a system library so
    // it gets resolved at build time from LIBRARY_PATH, instead of being baked
    // in as a machine-specific absolute path that breaks every other install.
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
    if (plan.k === "custom") {
      shim.push(plan.cCode);
      shim.push("");
      continue;
    }
    if (plan.k !== "wrap") continue;
    const cRetType = plan.ret.k === "scalar" ? PRIM_C[plan.ret.prim] : "void";
    shim.push(`${cRetType} ${plan.symbol}(${plan.cParams.join(", ")}) {`);
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
    if (plan.k === "custom") {
      decls.push(plan.ffiDecl);
      continue;
    }
    // Declarations must match the manifest ABI exactly: flattened structs
    // appear as individual scalar params (same naming as the C shim).
    const params: string[] = [];
    if (plan.k === "direct") {
      plan.params.forEach((p, i) => params.push(`a${i}: ${p.ts}`));
    } else {
      for (const p of plan.params) {
        if (p.k === "scalar") params.push(`${p.name}: ${PRIM_TS[p.prim]}`);
        else if (p.k === "string") params.push(`${p.name}: string`);
        else if (p.k === "bytes" || p.k === "opaque" || p.k === "mutable-opaque") params.push(`${p.name}: Uint8Array`);
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
  api.push(`declare var TextDecoder: { new (label?: string, options?: unknown): { decode(input?: Uint8Array | ArrayBufferView, options?: unknown): string } };`);
  api.push(``);
  api.push(`import {`);
  for (const { plan } of bound) api.push(`  ${plan.tsName},`);
  api.push(`} from "./raylib_ffi";`);
  api.push(``);
  for (const e of enums) {
    for (const v of e.values) api.push(`export const ${v.name} = ${v.value};`);
    if (e.name === "bool") continue;
    api.push(`export const ${e.name} = {`);
    for (const v of e.values) {
      api.push(`  ${v.name}: ${v.value},`);
    }
    if (e.name === "ConfigFlags") {
      for (const v of e.values) {
        if (v.name.startsWith("FLAG_")) {
          api.push(`  ${v.name.slice(5)}: ${v.value},`);
        }
      }
    }
    api.push(`} as const;`);
    api.push(`export type ${e.name} = number;`);
  }
  api.push(`export const CONFIG_FLAGS = ConfigFlags;`);
  api.push(`export const FLAGS = ConfigFlags;`);
  api.push(`export const FLAG = ConfigFlags;`);
  api.push(``);
  for (const name of ctx.structs.keys()) {
    const def = ctx.structs.get(name)!;
    if (def.fields.length === 0) continue;
    const lay = layoutStruct(name);
    if (name === "GlyphInfo") {
      api.push(`export interface GlyphInfo {\n  value: number;\n  offsetX: number;\n  offsetY: number;\n  advanceX: number;\n  image: Image;\n}`);
    } else if (lay.flat && !ctx.aliases.has(name)) {
      api.push(interfaceDecl(name));
    } else if (!ctx.aliases.has(name)) {
      api.push(`export type ${name} = Uint8Array;`);
    }
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
    if (name === "GlyphInfo") {
      api.push(`export function __read_GlyphInfo(__b: Uint8Array): GlyphInfo {\n  const __dv = new DataView(__b.buffer, __b.byteOffset, __b.byteLength);\n  return {\n    value: __dv.getInt32(0, true),\n    offsetX: __dv.getInt32(4, true),\n    offsetY: __dv.getInt32(8, true),\n    advanceX: __dv.getInt32(12, true),\n    image: new Uint8Array(__b.buffer, __b.byteOffset + 16, 24),\n  };\n}`);
    } else if (lay.flat && !ctx.aliases.has(name)) {
      api.push(readerFn(name));
    }
  }
  api.push(``);
  api.push(`export function __toVector2Bytes(points: Float32Array | Uint8Array | Vector2[]): [Uint8Array, number] {
  if (points instanceof Float32Array) {
    return [new Uint8Array(points.buffer, points.byteOffset, points.byteLength), Math.floor(points.length / 2)];
  }
  if (points instanceof Uint8Array) {
    return [points, Math.floor(points.byteLength / 8)];
  }
  const arr = points as Vector2[];
  const f = new Float32Array(arr.length * 2);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]!;
    f[i * 2] = v.x;
    f[i * 2 + 1] = v.y;
  }
  return [new Uint8Array(f.buffer), arr.length];
}

export function __toVector3Bytes(points: Float32Array | Uint8Array | Vector3[]): [Uint8Array, number] {
  if (points instanceof Float32Array) {
    return [new Uint8Array(points.buffer, points.byteOffset, points.byteLength), Math.floor(points.length / 3)];
  }
  if (points instanceof Uint8Array) {
    return [points, Math.floor(points.byteLength / 12)];
  }
  const arr = points as Vector3[];
  const f = new Float32Array(arr.length * 3);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]!;
    f[i * 3] = v.x;
    f[i * 3 + 1] = v.y;
    f[i * 3 + 2] = v.z;
  }
  return [new Uint8Array(f.buffer), arr.length];
}

export function __toMatrixBytes(transforms: Float32Array | Uint8Array | Matrix[]): [Uint8Array, number] {
  if (transforms instanceof Float32Array) {
    return [new Uint8Array(transforms.buffer, transforms.byteOffset, transforms.byteLength), Math.floor(transforms.length / 16)];
  }
  if (transforms instanceof Uint8Array) {
    return [transforms, Math.floor(transforms.byteLength / 64)];
  }
  const arr = transforms as Matrix[];
  const f = new Float32Array(arr.length * 16);
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i]!;
    f[i * 16 + 0] = m.m0;  f[i * 16 + 1] = m.m4;  f[i * 16 + 2] = m.m8;   f[i * 16 + 3] = m.m12;
    f[i * 16 + 4] = m.m1;  f[i * 16 + 5] = m.m5;  f[i * 16 + 6] = m.m9;   f[i * 16 + 7] = m.m13;
    f[i * 16 + 8] = m.m2;  f[i * 16 + 9] = m.m6;  f[i * 16 + 10] = m.m10; f[i * 16 + 11] = m.m14;
    f[i * 16 + 12] = m.m3; f[i * 16 + 13] = m.m7; f[i * 16 + 14] = m.m11; f[i * 16 + 15] = m.m15;
  }
  return [new Uint8Array(f.buffer), arr.length];
}

export function GetModelAnimationBoneCount(anim: ModelAnimation): number {
  return new DataView(anim.buffer, anim.byteOffset, anim.byteLength).getInt32(32, true);
}

export function GetModelAnimationFrameCount(anim: ModelAnimation): number {
  return new DataView(anim.buffer, anim.byteOffset, anim.byteLength).getInt32(36, true);
}

export function GetModelAnimationName(anim: ModelAnimation): string {
  let end = 0;
  while (end < 32 && anim[end] !== 0) end++;
  return new TextDecoder().decode(anim.subarray(0, end));
}

export function UnloadModelAnimation(anim: ModelAnimation): void {
  UnloadModelAnimations(anim, 1);
}`);
  api.push(``);
  for (const { fn, plan } of bound) {
    if (plan.k === "custom") {
      api.push(plan.apiCode);
      api.push("");
      continue;
    }
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
  api.push(`export function config(raylibPath?: string): void {}`);
  api.push(``);
  api.push(`export const Raylib = {`);
  api.push(`  config,`);
  for (const { fn } of bound) {
    const camel = fn.name.charAt(0).toLowerCase() + fn.name.slice(1);
    api.push(`  ${fn.name},`);
    if (camel !== fn.name) {
      api.push(`  ${camel}: ${fn.name},`);
    }
  }
  api.push(`  getModelAnimationBoneCount: GetModelAnimationBoneCount,`);
  api.push(`  GetModelAnimationBoneCount,`);
  api.push(`  getModelAnimationFrameCount: GetModelAnimationFrameCount,`);
  api.push(`  GetModelAnimationFrameCount,`);
  api.push(`  getModelAnimationName: GetModelAnimationName,`);
  api.push(`  GetModelAnimationName,`);
  api.push(`  unloadModelAnimation: UnloadModelAnimation,`);
  api.push(`  UnloadModelAnimation,`);
  for (const e of enums) {
    if (e.name === "bool") continue;
    api.push(`  ${e.name},`);
  }
  api.push(`  CONFIG_FLAGS: ConfigFlags,`);
  api.push(`  FLAGS: ConfigFlags,`);
  api.push(`  FLAG: ConfigFlags,`);
  const configEnum = enums.find((e) => e.name === "ConfigFlags");
  if (configEnum) {
    for (const v of configEnum.values) {
      api.push(`  ${v.name},`);
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
