# @dayme/scriptc-raylib — raylib bindings for scriptc

TypeScript bindings for [raylib 6.0](https://www.raylib.com), generated from the original C header
and linked via native [scriptc](https://scriptc.dev) FFI.

No Node.js, V8, or JIT engine inside — produces a compact, standalone static executable running at native machine speed.

---

## ⚡ Features

- **🚀 Native Performance**: Direct calls into raylib using the system ABI with zero intermediary overhead.
- **📦 npm-Ready**: Clean re-exports via `index.ts`, TypeScript typings, FFI manifest, and native C shim.
- **🎨 Built-in Colors and Constants**: Full `COLORS` palette (including `RAYWHITE`, `RED`, `DARKGRAY`, etc.), mathematical constants (`PI`, `DEG2RAD`, `RAD2DEG`), and enum namespaces (`KEYS`, `MOUSE`, `CAMERA`, `BLEND`).
- **🔄 Dual API Style**:
  - Direct C-style functions (`InitWindow`, `BeginDrawing`, `ClearBackground`, `DrawCircle`).
  - `Raylib` namespace with camelCase support (`Raylib.initWindow`, `Raylib.beginDrawing`, `Raylib.drawCircle`).
- **🛡️ 501 raylib Functions**: 116 direct scalar calls + 355 wrapped via C shim with compile-time layout checks (`_Static_assert`) + 30 custom FFI adapters (83.5% of raylib).

---

## 🏗️ Architecture & How It Works

```
raylib.h ──(tools/gen_bindings.ts)──► gen/raylib_ffi.json   FFI manifest (format 6)
                                  ├─► gen/raylib_shim.c     C wrappers ──► libraylib_shim.a
                                  ├─► gen/raylib_ffi.ts     raw declare rl_*
                                  └─► gen/raylib.ts         typed API + enums + structs
                                        │
                                        ▼
                                     src/index.ts           re-exports, COLORS, KEYS, Raylib
                                        │
demo/main.ts ──(scriptc build --ffi)───┴──────────────────► demo/demo (native binary)
```

The generator classifies each of the 600 raylib functions into three groups:

1. **direct (116)** — scalar-only signature: links directly to the original raylib symbol without intermediate C code.
2. **wrapped (355) + custom (30)** — functions requiring a C shim or specialized adapters:
   - `const char*` → `string` class (ptr + len): shim copies into a NUL-terminated buffer;
   - value struct with scalar-only fields (`Vector2`, `Color`, `Camera3D`, `Texture`, `Matrix`...) → unpacked into individual scalar arguments, shim reconstructs struct with a compound literal;
   - struct with internal pointers (`Image`, `Sound`, `Music`, `Shader`, `Model`...) → TS holds a `Uint8Array` of struct bytes and passes it as a buffer (`bytes` class), shim performs memcpy;
   - struct return → shim copies it into a trailing out-buffer `Uint8Array` (`mutable-bytes` class), TS unpacks fields via `DataView` at offsets validated with `_Static_assert(sizeof(...))`;
   - string returns (`GetMonitorName`, `GetClipboardText`, `GetGamepadName`) → returned via `mutable-bytes` buffer decoded using `TextDecoder`;
   - vertex arrays (`DrawLineStrip`, `DrawTriangleFan`, `DrawTriangleStrip`, `DrawSpline*`, `DrawTriangleStrip3D`) → byte buffers of `Float32Array | Uint8Array | Vector2[]/Vector3[]`;
   - **mesh instancing (`DrawMeshInstanced`)** — takes transformation matrix array (`Float32Array | Uint8Array | Matrix[]`) and automatically binds the built-in instancing shader;
   - **line collision check (`CheckCollisionLines`)** — returns a structured object `{ collision: boolean, point: Vector2 }`;
   - **memory loading (`LoadImageFromMemory`, `LoadWaveFromMemory`, `LoadMusicStreamFromMemory`)** — decodes png/jpg/wav/ogg/mp3 directly from `Uint8Array` byte buffers;
   - **model animations (`LoadModelAnimations`, `UnloadModelAnimations`)** — loads skeletal animation sequences into a `ModelAnimation[]` array.
3. **skipped (99)** — functions unsupported due to FFI architecture constraints (see detailed breakdown below).

---

## 📦 Installation & Quick Start

### Prerequisites

1. **raylib 5.5 / 6.0**:
   - **macOS**: `brew install raylib` (or MacPorts: `sudo port install raylib`)
   - **Linux (Ubuntu/Debian)**: `sudo apt install libraylib-dev`
   - **Linux (Arch Linux)**: `sudo pacman -S raylib`
   - **Linux (Fedora)**: `sudo dnf install raylib-devel`
   - **Windows**: MSYS2 (`pacman -S mingw-w64-x86_64-raylib`), vcpkg (`vcpkg install raylib:x64-windows`), or the official [raylib Windows Installer](https://www.raylib.com).
2. **scriptc compiler** (version 0.2.3 or newer): `npm install -g scriptc`.
3. **C compiler** (`cc` / `gcc` / `clang`) — to compile the platform shim.

### Step 1. Install package

```sh
npm install @dayme/scriptc-raylib
# or
bun add @dayme/scriptc-raylib
```

### Step 2. Build C shim (required)

The `libraylib_shim.a` library is not shipped prebuilt because it depends on the consumer's CPU architecture, compiler ABI, and installed raylib version. Run the build command once:

```sh
# Automatic discovery in standard locations (Homebrew, /usr/lib, MSYS2, vcpkg):
npx createshim

# Or with a custom raylib path:
# npx createshim /opt/homebrew/lib
# npx createshim C:/raylib/raylib/src
```

This compiles `gen/raylib_shim.c` into `gen/libraylib_shim.a`, links `./raylib -> node_modules/@dayme/scriptc-raylib`, sets up `tsconfig.json` path mapping so `scriptc` compiles the package 100% statically without embedding any dynamic engine, embeds the detected raylib library path into the FFI manifest, and prints out ready-to-use commands. To inspect detected paths:

```sh
npx createshim paths
```

### Step 3. Application code

In your game code, import `Raylib` and `COLORS`:

```ts
import { Raylib, COLORS } from "@dayme/scriptc-raylib";

Raylib.config();

Raylib.initWindow(800, 450, "@dayme/scriptc-raylib demo");
Raylib.setTargetFPS(60);

while (!Raylib.windowShouldClose()) {
  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.DARKGRAY);
  Raylib.drawText("Hello from @dayme/scriptc-raylib!", 190, 200, 20, COLORS.RAYWHITE);
  Raylib.endDrawing();
}

Raylib.closeWindow();
```

---

## 🚀 Step 4. Run and Build with `scriptc`

Run and build using the standard `scriptc` command with the `--ffi` manifest flag:

```sh
# Run your game:
scriptc run src/main.ts --ffi node_modules/@dayme/scriptc-raylib/gen/raylib_ffi.json

# Build a standalone native binary:
scriptc build src/main.ts --ffi node_modules/@dayme/scriptc-raylib/gen/raylib_ffi.json -o game
./game
```

---

## 🎨 Usage Examples

### Option 1. Direct function imports (recommended)

```ts
import {
  InitWindow,
  CloseWindow,
  WindowShouldClose,
  BeginDrawing,
  EndDrawing,
  ClearBackground,
  DrawText,
  DrawFPS,
  COLORS,
  KEY_ESCAPE,
  IsKeyDown,
  Raylib,
} from "@dayme/scriptc-raylib";

Raylib.config();

InitWindow(800, 450, "scriptc-raylib demo");

while (!WindowShouldClose()) {
  if (IsKeyDown(KEY_ESCAPE)) break;

  BeginDrawing();
  ClearBackground(COLORS.DARKGRAY);
  DrawText("Hello from @dayme/scriptc-raylib!", 100, 200, 24, COLORS.RAYWHITE);
  DrawFPS(10, 10);
  EndDrawing();
}

CloseWindow();
```

### Option 2. Via `Raylib` namespace & camelCase

```ts
import { Raylib, COLORS, KEYS } from "@dayme/scriptc-raylib";

Raylib.config();
Raylib.initWindow(800, 450, "scriptc-raylib demo");
Raylib.setTargetFPS(60);

while (!Raylib.windowShouldClose()) {
  if (Raylib.isKeyDown(KEYS.ESCAPE)) break;

  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.DARKGRAY);
  Raylib.drawCircle(400, 225, 50, COLORS.GOLD);
  Raylib.endDrawing();
}

Raylib.closeWindow();
```

### 🎮 Running Examples

The repository includes 12 ready-to-run examples in `examples/`:
`index`, `shapes`, `shapes3d`, `textures`, `fonts`, `audio`, `models`, `shader`, `image`, `camera`, `breakout`, `instancing`.

Since `scriptc` is an AOT compiler, pass the FFI manifest flag `--ffi`:

```sh
# Directly with scriptc run:
scriptc run examples/index.ts --ffi gen/raylib_ffi.json

# Or with the runner script (automatically attaches --ffi and LIBRARY_PATH):
bun run example index
bun run example shapes
bun run example instancing

# Or compile to a standalone executable:
scriptc build examples/instancing.ts --ffi gen/raylib_ffi.json -o examples/instancing
./examples/instancing
```

---

## 💡 Memory Management & Zero Asset Limits

Unlike fixed static registry approaches (e.g. `MAX_MODELS 64`, `MAX_IMAGES 128`, `MAX_SOUNDS 32`):

- **No limits in `@dayme/scriptc-raylib`:** Every complex raylib structure (`Model`, `Image`, `Sound`, `Music`, `Shader`, `Font`, `Wave`, `Mesh`, `Material`, `ModelAnimation`) is represented as an independent `Uint8Array` buffer of exact size `sizeof(Struct)`.
- **Direct round-trip:** When calling `LoadModel()`, the C shim copies the native structure into a newly allocated `Uint8Array`. In TS, you own this handle directly. When passed into drawing functions, the byte buffer is passed straight back to C without lookup tables.
- **Scalability:** You can load hundreds of thousands of models, textures, or sounds — limited only by available system RAM.

---

## 📊 Implementation Status

Total raylib 6.0 header functions: **600 functions**:
- **501 implemented** (116 direct + 355 wrapped + 30 custom) — **83.5%**
- **99 skipped** due to FFI architecture constraints — **16.5%**

### Summary by Module

| Module | Implemented | Skipped | Total | Progress |
|---|:---:|:---:|:---:|:---:|
| **Core / Window & Graphics Device** | 126 | 43 | 169 | 75% |
| **Input Handling (Keyboard, Mouse, Gamepad)** | 38 | 1 | 39 | 97% |
| **Gestures & Touch** | 8 | 0 | 8 | 100% |
| **Camera System** | 2 | 0 | 2 | 100% |
| **2D Shapes & Splines** | 70 | 0 | 70 | 100% |
| **Textures & Images** | 98 | 16 | 114 | 86% |
| **Fonts & Text** | 28 | 31 | 59 | 47% |
| **3D Shapes Drawing** | 21 | 0 | 21 | 100% |
| **3D Models & Materials** | 49 | 3 | 52 | 94% |
| **Audio & Music** | 61 | 5 | 66 | 92% |
| **TOTAL** | **501** | **99** | **600** | **83.5%** |

---

## ✅ Implemented Functions (501)

Every function is fully typed, tested, and callable in both PascalCase and camelCase.


<details>
<summary><b>Core / Window & Graphics Device (122/169)</b></summary>

- [x] `InitWindow`
- [x] `CloseWindow`
- [x] `WindowShouldClose`
- [x] `IsWindowReady`
- [x] `IsWindowFullscreen`
- [x] `IsWindowHidden`
- [x] `IsWindowMinimized`
- [x] `IsWindowMaximized`
- [x] `IsWindowFocused`
- [x] `IsWindowResized`
- [x] `IsWindowState`
- [x] `SetWindowState`
- [x] `ClearWindowState`
- [x] `ToggleFullscreen`
- [x] `ToggleBorderlessWindowed`
- [x] `MaximizeWindow`
- [x] `MinimizeWindow`
- [x] `RestoreWindow`
- [x] `SetWindowIcon`
- [x] `SetWindowTitle`
- [x] `SetWindowPosition`
- [x] `SetWindowMonitor`
- [x] `SetWindowMinSize`
- [x] `SetWindowMaxSize`
- [x] `SetWindowSize`
- [x] `SetWindowOpacity`
- [x] `SetWindowFocused`
- [x] `GetScreenWidth`
- [x] `GetScreenHeight`
- [x] `GetRenderWidth`
- [x] `GetRenderHeight`
- [x] `GetMonitorCount`
- [x] `GetCurrentMonitor`
- [x] `GetMonitorPosition`
- [x] `GetMonitorWidth`
- [x] `GetMonitorHeight`
- [x] `GetMonitorPhysicalWidth`
- [x] `GetMonitorPhysicalHeight`
- [x] `GetMonitorRefreshRate`
- [x] `GetWindowPosition`
- [x] `GetWindowScaleDPI`
- [x] `SetClipboardText`
- [x] `GetClipboardImage`
- [x] `EnableEventWaiting`
- [x] `DisableEventWaiting`
- [x] `ShowCursor`
- [x] `HideCursor`
- [x] `IsCursorHidden`
- [x] `EnableCursor`
- [x] `DisableCursor`
- [x] `IsCursorOnScreen`
- [x] `ClearBackground`
- [x] `BeginDrawing`
- [x] `EndDrawing`
- [x] `BeginMode2D`
- [x] `EndMode2D`
- [x] `BeginMode3D`
- [x] `EndMode3D`
- [x] `BeginTextureMode`
- [x] `EndTextureMode`
- [x] `BeginShaderMode`
- [x] `EndShaderMode`
- [x] `BeginBlendMode`
- [x] `EndBlendMode`
- [x] `BeginScissorMode`
- [x] `EndScissorMode`
- [x] `BeginVrStereoMode`
- [x] `EndVrStereoMode`
- [x] `LoadVrStereoConfig`
- [x] `UnloadVrStereoConfig`
- [x] `LoadShader`
- [x] `LoadShaderFromMemory`
- [x] `IsShaderValid`
- [x] `GetShaderLocation`
- [x] `GetShaderLocationAttrib`
- [x] `SetShaderValue`
- [x] `SetShaderValueV`
- [x] `SetShaderValueMatrix`
- [x] `SetShaderValueTexture`
- [x] `UnloadShader`
- [x] `GetScreenToWorldRay`
- [x] `GetScreenToWorldRayEx`
- [x] `GetWorldToScreen`
- [x] `GetWorldToScreenEx`
- [x] `GetWorldToScreen2D`
- [x] `GetScreenToWorld2D`
- [x] `GetCameraMatrix`
- [x] `GetCameraMatrix2D`
- [x] `SetTargetFPS`
- [x] `GetFrameTime`
- [x] `GetTime`
- [x] `GetFPS`
- [x] `SwapScreenBuffer`
- [x] `PollInputEvents`
- [x] `WaitTime`
- [x] `SetRandomSeed`
- [x] `GetRandomValue`
- [x] `SetConfigFlags`
- [x] `OpenURL`
- [x] `SetTraceLogLevel`
- [x] `FileRename`
- [x] `FileRemove`
- [x] `FileCopy`
- [x] `FileMove`
- [x] `FileTextReplace`
- [x] `FileTextFindIndex`
- [x] `IsFileExtension`
- [x] `GetFileLength`
- [x] `MakeDirectory`
- [x] `IsPathFile`
- [x] `IsFileNameValid`
- [x] `LoadDirectoryFiles`
- [x] `LoadDirectoryFilesEx`
- [x] `UnloadDirectoryFiles`
- [x] `GetDirectoryFileCount`
- [x] `GetDirectoryFileCountEx`
- [x] `UnloadAutomationEventList`
- [x] `ExportAutomationEventList`
- [x] `SetAutomationEventBaseFrame`
- [x] `StartAutomationEventRecording`
- [x] `StopAutomationEventRecording`
- [x] `PlayAutomationEvent`

</details>

<details>
<summary><b>Input Handling (Keyboard, Mouse) (37/39)</b></summary>

- [x] `IsKeyPressed`
- [x] `IsKeyPressedRepeat`
- [x] `IsKeyDown`
- [x] `IsKeyReleased`
- [x] `IsKeyUp`
- [x] `GetKeyPressed`
- [x] `GetCharPressed`
- [x] `SetExitKey`
- [x] `IsGamepadAvailable`
- [x] `IsGamepadButtonPressed`
- [x] `IsGamepadButtonDown`
- [x] `IsGamepadButtonReleased`
- [x] `IsGamepadButtonUp`
- [x] `GetGamepadButtonPressed`
- [x] `GetGamepadAxisCount`
- [x] `GetGamepadAxisMovement`
- [x] `SetGamepadMappings`
- [x] `SetGamepadVibration`
- [x] `IsMouseButtonPressed`
- [x] `IsMouseButtonDown`
- [x] `IsMouseButtonReleased`
- [x] `IsMouseButtonUp`
- [x] `GetMouseX`
- [x] `GetMouseY`
- [x] `GetMousePosition`
- [x] `GetMouseDelta`
- [x] `SetMousePosition`
- [x] `SetMouseOffset`
- [x] `SetMouseScale`
- [x] `GetMouseWheelMove`
- [x] `GetMouseWheelMoveV`
- [x] `SetMouseCursor`
- [x] `GetTouchX`
- [x] `GetTouchY`
- [x] `GetTouchPosition`
- [x] `GetTouchPointId`
- [x] `GetTouchPointCount`

</details>

<details>
<summary><b>Gestures & Touch (8/8)</b></summary>

- [x] `SetGesturesEnabled`
- [x] `IsGestureDetected`
- [x] `GetGestureDetected`
- [x] `GetGestureHoldDuration`
- [x] `GetGestureDragVector`
- [x] `GetGestureDragAngle`
- [x] `GetGesturePinchVector`
- [x] `GetGesturePinchAngle`

</details>

<details>
<summary><b>2D Shapes & Splines (59/69)</b></summary>

- [x] `SetShapesTexture`
- [x] `GetShapesTexture`
- [x] `GetShapesTextureRectangle`
- [x] `DrawPixel`
- [x] `DrawPixelV`
- [x] `DrawLine`
- [x] `DrawLineV`
- [x] `DrawLineEx`
- [x] `DrawLineBezier`
- [x] `DrawLineDashed`
- [x] `DrawCircle`
- [x] `DrawCircleV`
- [x] `DrawCircleGradient`
- [x] `DrawCircleSector`
- [x] `DrawCircleSectorLines`
- [x] `DrawCircleLines`
- [x] `DrawCircleLinesV`
- [x] `DrawEllipse`
- [x] `DrawEllipseV`
- [x] `DrawEllipseLines`
- [x] `DrawEllipseLinesV`
- [x] `DrawRing`
- [x] `DrawRingLines`
- [x] `DrawRectangle`
- [x] `DrawRectangleV`
- [x] `DrawRectangleRec`
- [x] `DrawRectanglePro`
- [x] `DrawRectangleGradientV`
- [x] `DrawRectangleGradientH`
- [x] `DrawRectangleGradientEx`
- [x] `DrawRectangleLines`
- [x] `DrawRectangleLinesEx`
- [x] `DrawRectangleRounded`
- [x] `DrawRectangleRoundedLines`
- [x] `DrawRectangleRoundedLinesEx`
- [x] `DrawTriangle`
- [x] `DrawTriangleLines`
- [x] `DrawPoly`
- [x] `DrawPolyLines`
- [x] `DrawPolyLinesEx`
- [x] `DrawSplineSegmentLinear`
- [x] `DrawSplineSegmentBasis`
- [x] `DrawSplineSegmentCatmullRom`
- [x] `DrawSplineSegmentBezierQuadratic`
- [x] `DrawSplineSegmentBezierCubic`
- [x] `GetSplinePointLinear`
- [x] `GetSplinePointBasis`
- [x] `GetSplinePointCatmullRom`
- [x] `GetSplinePointBezierQuad`
- [x] `GetSplinePointBezierCubic`
- [x] `CheckCollisionRecs`
- [x] `CheckCollisionCircles`
- [x] `CheckCollisionCircleRec`
- [x] `CheckCollisionCircleLine`
- [x] `CheckCollisionPointRec`
- [x] `CheckCollisionPointCircle`
- [x] `CheckCollisionPointTriangle`
- [x] `CheckCollisionPointLine`
- [x] `GetCollisionRec`

</details>

<details>
<summary><b>Textures & Images (55/115)</b></summary>

- [x] `LoadImage`
- [x] `LoadImageRaw`
- [x] `LoadImageFromTexture`
- [x] `LoadImageFromScreen`
- [x] `IsImageValid`
- [x] `UnloadImage`
- [x] `GenImageColor`
- [x] `GenImageGradientLinear`
- [x] `GenImageGradientRadial`
- [x] `GenImageGradientSquare`
- [x] `GenImageChecked`
- [x] `GenImageWhiteNoise`
- [x] `GenImagePerlinNoise`
- [x] `GenImageCellular`
- [x] `GenImageText`
- [x] `ImageCopy`
- [x] `ImageFromImage`
- [x] `ImageFromChannel`
- [x] `ImageText`
- [x] `ImageTextEx`
- [x] `GetImageAlphaBorder`
- [x] `GetImageColor`
- [x] `LoadTexture`
- [x] `LoadTextureFromImage`
- [x] `LoadTextureCubemap`
- [x] `LoadRenderTexture`
- [x] `IsTextureValid`
- [x] `UnloadTexture`
- [x] `IsRenderTextureValid`
- [x] `UnloadRenderTexture`
- [x] `UpdateTexture`
- [x] `UpdateTextureRec`
- [x] `SetTextureFilter`
- [x] `SetTextureWrap`
- [x] `DrawTexture`
- [x] `DrawTextureV`
- [x] `DrawTextureEx`
- [x] `DrawTextureRec`
- [x] `DrawTexturePro`
- [x] `DrawTextureNPatch`
- [x] `ColorIsEqual`
- [x] `Fade`
- [x] `ColorToInt`
- [x] `ColorNormalize`
- [x] `ColorFromNormalized`
- [x] `ColorToHSV`
- [x] `ColorFromHSV`
- [x] `ColorTint`
- [x] `ColorBrightness`
- [x] `ColorContrast`
- [x] `ColorAlpha`
- [x] `ColorAlphaBlend`
- [x] `ColorLerp`
- [x] `GetColor`
- [x] `GetPixelDataSize`

</details>

<details>
<summary><b>Fonts & Text (23/59)</b></summary>

- [x] `GetFontDefault`
- [x] `LoadFont`
- [x] `LoadFontFromImage`
- [x] `IsFontValid`
- [x] `UnloadFont`
- [x] `ExportFontAsCode`
- [x] `DrawFPS`
- [x] `DrawText`
- [x] `DrawTextEx`
- [x] `DrawTextPro`
- [x] `DrawTextCodepoint`
- [x] `SetTextLineSpacing`
- [x] `MeasureText`
- [x] `MeasureTextEx`
- [x] `GetGlyphIndex`
- [x] `GetGlyphInfo`
- [x] `GetGlyphAtlasRec`
- [x] `GetCodepointCount`
- [x] `TextIsEqual`
- [x] `TextLength`
- [x] `TextFindIndex`
- [x] `TextToInteger`
- [x] `TextToFloat`

</details>

<details>
<summary><b>3D Shapes Drawing (20/21)</b></summary>

- [x] `DrawLine3D`
- [x] `DrawPoint3D`
- [x] `DrawCircle3D`
- [x] `DrawTriangle3D`
- [x] `DrawCube`
- [x] `DrawCubeV`
- [x] `DrawCubeWires`
- [x] `DrawCubeWiresV`
- [x] `DrawSphere`
- [x] `DrawSphereEx`
- [x] `DrawSphereWires`
- [x] `DrawCylinder`
- [x] `DrawCylinderEx`
- [x] `DrawCylinderWires`
- [x] `DrawCylinderWiresEx`
- [x] `DrawCapsule`
- [x] `DrawCapsuleWires`
- [x] `DrawPlane`
- [x] `DrawRay`
- [x] `DrawGrid`

</details>

<details>
<summary><b>3D Models & Materials (43/52)</b></summary>

- [x] `LoadModel`
- [x] `LoadModelFromMesh`
- [x] `IsModelValid`
- [x] `UnloadModel`
- [x] `GetModelBoundingBox`
- [x] `DrawModel`
- [x] `DrawModelEx`
- [x] `DrawModelWires`
- [x] `DrawModelWiresEx`
- [x] `DrawBoundingBox`
- [x] `DrawBillboard`
- [x] `DrawBillboardRec`
- [x] `DrawBillboardPro`
- [x] `UpdateMeshBuffer`
- [x] `UnloadMesh`
- [x] `DrawMesh`
- [x] `GetMeshBoundingBox`
- [x] `ExportMeshAsCode`
- [x] `GenMeshPoly`
- [x] `GenMeshPlane`
- [x] `GenMeshCube`
- [x] `GenMeshSphere`
- [x] `GenMeshHemiSphere`
- [x] `GenMeshCylinder`
- [x] `GenMeshCone`
- [x] `GenMeshTorus`
- [x] `GenMeshKnot`
- [x] `GenMeshHeightmap`
- [x] `GenMeshCubicmap`
- [x] `LoadMaterialDefault`
- [x] `IsMaterialValid`
- [x] `UnloadMaterial`
- [x] `UpdateModelAnimation`
- [x] `UpdateModelAnimationEx`
- [x] `IsModelAnimationValid`
- [x] `CheckCollisionSpheres`
- [x] `CheckCollisionBoxes`
- [x] `CheckCollisionBoxSphere`
- [x] `GetRayCollisionSphere`
- [x] `GetRayCollisionBox`
- [x] `GetRayCollisionMesh`
- [x] `GetRayCollisionTriangle`
- [x] `GetRayCollisionQuad`

</details>

<details>
<summary><b>Audio & Music (55/66)</b></summary>

- [x] `InitAudioDevice`
- [x] `CloseAudioDevice`
- [x] `IsAudioDeviceReady`
- [x] `SetMasterVolume`
- [x] `GetMasterVolume`
- [x] `LoadWave`
- [x] `IsWaveValid`
- [x] `LoadSound`
- [x] `LoadSoundFromWave`
- [x] `LoadSoundAlias`
- [x] `IsSoundValid`
- [x] `UpdateSound`
- [x] `UnloadWave`
- [x] `UnloadSound`
- [x] `UnloadSoundAlias`
- [x] `ExportWave`
- [x] `ExportWaveAsCode`
- [x] `PlaySound`
- [x] `StopSound`
- [x] `PauseSound`
- [x] `ResumeSound`
- [x] `IsSoundPlaying`
- [x] `SetSoundVolume`
- [x] `SetSoundPitch`
- [x] `SetSoundPan`
- [x] `WaveCopy`
- [x] `LoadMusicStream`
- [x] `IsMusicValid`
- [x] `UnloadMusicStream`
- [x] `PlayMusicStream`
- [x] `IsMusicStreamPlaying`
- [x] `UpdateMusicStream`
- [x] `StopMusicStream`
- [x] `PauseMusicStream`
- [x] `ResumeMusicStream`
- [x] `SeekMusicStream`
- [x] `SetMusicVolume`
- [x] `SetMusicPitch`
- [x] `SetMusicPan`
- [x] `GetMusicTimeLength`
- [x] `GetMusicTimePlayed`
- [x] `LoadAudioStream`
- [x] `IsAudioStreamValid`
- [x] `UnloadAudioStream`
- [x] `UpdateAudioStream`
- [x] `IsAudioStreamProcessed`
- [x] `PlayAudioStream`
- [x] `PauseAudioStream`
- [x] `ResumeAudioStream`
- [x] `IsAudioStreamPlaying`
- [x] `StopAudioStream`
- [x] `SetAudioStreamVolume`
- [x] `SetAudioStreamPitch`
- [x] `SetAudioStreamPan`
- [x] `SetAudioStreamBufferSizeDefault`

</details>

---

## 🚫 Functions Not Implemented (178)

Below are all excluded functions, grouped by reason with detailed explanations.


### Struct Mutation via Pointer (struct-pointer) (74)

> **Why skipped:** Functions accept a mutable pointer to a C struct (`Image*`, `Camera3D*`, `Mesh*`, `Material*`, `Wave*`) for in-place mutation, or vertex/point arrays (`Vector2*` in `DrawLineStrip`, `DrawTriangleStrip`, `DrawSpline*`). In scriptc FFI, structs are passed by value via unpacked scalar fields or opaque `Uint8Array` buffers. Mutable pointers into scriptc struct internals are not supported.

<details>
<summary><b>List of skipped functions (74)</b></summary>

- [ ] `SetWindowIcons`
- [ ] `UpdateCamera`
- [ ] `UpdateCameraPro`
- [ ] `DrawLineStrip`
- [ ] `DrawTriangleFan`
- [ ] `DrawTriangleStrip`
- [ ] `DrawSplineLinear`
- [ ] `DrawSplineBasis`
- [ ] `DrawSplineCatmullRom`
- [ ] `DrawSplineBezierQuadratic`
- [ ] `DrawSplineBezierCubic`
- [ ] `CheckCollisionPointPoly`
- [ ] `CheckCollisionLines`
- [ ] `ImageFormat`
- [ ] `ImageToPOT`
- [ ] `ImageCrop`
- [ ] `ImageAlphaCrop`
- [ ] `ImageAlphaClear`
- [ ] `ImageAlphaMask`
- [ ] `ImageAlphaPremultiply`
- [ ] `ImageBlurGaussian`
- [ ] `ImageKernelConvolution`
- [ ] `ImageResize`
- [ ] `ImageResizeNN`
- [ ] `ImageResizeCanvas`
- [ ] `ImageMipmaps`
- [ ] `ImageDither`
- [ ] `ImageFlipVertical`
- [ ] `ImageFlipHorizontal`
- [ ] `ImageRotate`
- [ ] `ImageRotateCW`
- [ ] `ImageRotateCCW`
- [ ] `ImageColorTint`
- [ ] `ImageColorInvert`
- [ ] `ImageColorGrayscale`
- [ ] `ImageColorContrast`
- [ ] `ImageColorBrightness`
- [ ] `ImageColorReplace`
- [ ] `UnloadImageColors`
- [ ] `UnloadImagePalette`
- [ ] `ImageClearBackground`
- [ ] `ImageDrawPixel`
- [ ] `ImageDrawPixelV`
- [ ] `ImageDrawLine`
- [ ] `ImageDrawLineV`
- [ ] `ImageDrawLineEx`
- [ ] `ImageDrawCircle`
- [ ] `ImageDrawCircleV`
- [ ] `ImageDrawCircleLines`
- [ ] `ImageDrawCircleLinesV`
- [ ] `ImageDrawRectangle`
- [ ] `ImageDrawRectangleV`
- [ ] `ImageDrawRectangleRec`
- [ ] `ImageDrawRectangleLines`
- [ ] `ImageDrawTriangle`
- [ ] `ImageDrawTriangleEx`
- [ ] `ImageDrawTriangleLines`
- [ ] `ImageDrawTriangleFan`
- [ ] `ImageDrawTriangleStrip`
- [ ] `ImageDraw`
- [ ] `ImageDrawText`
- [ ] `ImageDrawTextEx`
- [ ] `GenTextureMipmaps`
- [ ] `GenImageFontAtlas`
- [ ] `UnloadFontData`
- [ ] `DrawTriangleStrip3D`
- [ ] `UploadMesh`
- [ ] `DrawMeshInstanced`
- [ ] `GenMeshTangents`
- [ ] `SetMaterialTexture`
- [ ] `SetModelMeshMaterial`
- [ ] `UnloadModelAnimations`
- [ ] `WaveCrop`
- [ ] `WaveFormat`

</details>

### OS File Operations (file-io) (26)

> **Why skipped:** Direct OS filesystem calls (`FileExists`, `DirectoryExists`, `LoadFileData`, `SaveFileText`, `ExportImage`, `GetFileName`, `GetDirectoryPath`, etc.). Filesystem and path management belongs to standard runtime/OS utilities. **Resource loaders are preserved:** `LoadTexture`, `LoadSound`, `LoadMusicStream`, `LoadFont`, `LoadModel`, `LoadShader` work normally.

<details>
<summary><b>List of skipped functions (26)</b></summary>

- [ ] `TakeScreenshot`
- [ ] `LoadFileData`
- [ ] `UnloadFileData`
- [ ] `SaveFileData`
- [ ] `ExportDataAsCode`
- [ ] `LoadFileText`
- [ ] `UnloadFileText`
- [ ] `SaveFileText`
- [ ] `FileExists`
- [ ] `DirectoryExists`
- [ ] `GetFileModTime`
- [ ] `GetFileExtension`
- [ ] `GetFileName`
- [ ] `GetFileNameWithoutExt`
- [ ] `GetDirectoryPath`
- [ ] `GetWorkingDirectory`
- [ ] `GetApplicationDirectory`
- [ ] `ChangeDirectory`
- [ ] `IsFileDropped`
- [ ] `LoadDroppedFiles`
- [ ] `UnloadDroppedFiles`
- [ ] `LoadAutomationEventList`
- [ ] `SetAutomationEventList`
- [ ] `ExportImage`
- [ ] `ExportImageAsCode`
- [ ] `ExportMesh`

</details>

### C-String Return (string-return) (23)

> **Why skipped:** Functions returning `const char*` / `char*` (`GetClipboardText`, `GetMonitorName`, `GetGamepadName`, utility functions `TextToUpper`, `TextToLower`, etc.). Returning dynamically allocated C strings without clear memory ownership contracts (who calls `free` and when) causes memory leaks or dangling pointers.

<details>
<summary><b>List of skipped functions (23)</b></summary>

- [ ] `GetMonitorName`
- [ ] `GetClipboardText`
- [ ] `GetPrevDirectoryPath`
- [ ] `EncodeDataBase64`
- [ ] `GetKeyName`
- [ ] `GetGamepadName`
- [ ] `LoadUTF8`
- [ ] `CodepointToUTF8`
- [ ] `TextSubtext`
- [ ] `TextRemoveSpaces`
- [ ] `GetTextBetween`
- [ ] `TextReplace`
- [ ] `TextReplaceAlloc`
- [ ] `TextReplaceBetween`
- [ ] `TextReplaceBetweenAlloc`
- [ ] `TextInsert`
- [ ] `TextInsertAlloc`
- [ ] `TextJoin`
- [ ] `TextToUpper`
- [ ] `TextToLower`
- [ ] `TextToPascal`
- [ ] `TextToSnake`
- [ ] `TextToCamel`

</details>

### Raw Pointer Return (pointer-return) (18)

> **Why skipped:** Functions returning untyped pointers (`void*`, `Color*`, `char**`, `Transform**` — e.g. `GetWindowHandle`, `LoadImageColors`, `LoadFontData`, `TextSplit`, `LoadMaterials`). In typed TypeScript code, these cannot be safely dereferenced without buffer size and layout metadata.

<details>
<summary><b>List of skipped functions (18)</b></summary>

- [ ] `GetWindowHandle`
- [ ] `LoadRandomSequence`
- [ ] `CompressData`
- [ ] `DecompressData`
- [ ] `DecodeDataBase64`
- [ ] `ComputeMD5`
- [ ] `ComputeSHA1`
- [ ] `ComputeSHA256`
- [ ] `ExportImageToMemory`
- [ ] `LoadImageColors`
- [ ] `LoadImagePalette`
- [ ] `LoadFontData`
- [ ] `LoadCodepoints`
- [ ] `LoadTextLines`
- [ ] `TextSplit`
- [ ] `LoadMaterials`
- [ ] `LoadModelAnimations`
- [ ] `LoadWaveSamples`

</details>

### Memory/Count Pointer Parameters (pointer-param) (17)

> **Why skipped:** Functions requiring pointers to output variables or raw memory blocks (`int* count`, `void* data` — e.g. `LoadImageAnim`, `DrawTextCodepoints`, `GetCodepoint`, `UnloadWaveSamples`).

<details>
<summary><b>List of skipped functions (17)</b></summary>

- [ ] `UnloadRandomSequence`
- [ ] `ComputeCRC32`
- [ ] `LoadImageAnim`
- [ ] `LoadImageAnimFromMemory`
- [ ] `LoadImageFromMemory`
- [ ] `LoadFontEx`
- [ ] `LoadFontFromMemory`
- [ ] `DrawTextCodepoints`
- [ ] `MeasureTextCodepoints`
- [ ] `UnloadCodepoints`
- [ ] `GetCodepoint`
- [ ] `GetCodepointNext`
- [ ] `GetCodepointPrevious`
- [ ] `UnloadTextLines`
- [ ] `LoadWaveFromMemory`
- [ ] `UnloadWaveSamples`
- [ ] `LoadMusicStreamFromMemory`

</details>

### C Callbacks (callback) (10)

> **Why skipped:** Functions taking C function pointers as callbacks (`SetAudioStreamCallback`, `SetTraceLogCallback`, `AttachAudioStreamProcessor`, etc.). Calling from native C back into the TypeScript executable context is not supported in scriptc's static FFI.

<details>
<summary><b>List of skipped functions (10)</b></summary>

- [ ] `SetTraceLogCallback`
- [ ] `SetLoadFileDataCallback`
- [ ] `SetSaveFileDataCallback`
- [ ] `SetLoadFileTextCallback`
- [ ] `SetSaveFileTextCallback`
- [ ] `SetAudioStreamCallback`
- [ ] `AttachAudioStreamProcessor`
- [ ] `DetachAudioStreamProcessor`
- [ ] `AttachAudioMixedProcessor`
- [ ] `DetachAudioMixedProcessor`

</details>

### Mutable Byte Pointers (mutable-pointer) (5)

> **Why skipped:** Functions requiring mutable `void*` or `char*` parameters without buffer length information (`GetPixelColor`, `SetPixelColor`, `TextCopy`, `TextAppend`, `UnloadUTF8`).

<details>
<summary><b>List of skipped functions (5)</b></summary>

- [ ] `GetPixelColor`
- [ ] `SetPixelColor`
- [ ] `UnloadUTF8`
- [ ] `TextCopy`
- [ ] `TextAppend`

</details>

### Manual C Memory Management (manual-memory) (3)

> **Why skipped:** Low-level C allocator functions (`MemAlloc`, `MemRealloc`, `MemFree`). Manual memory allocation is unsafe and unnecessary in TypeScript.

<details>
<summary><b>List of skipped functions (3)</b></summary>

- [ ] `MemAlloc`
- [ ] `MemRealloc`
- [ ] `MemFree`

</details>

### Variadic C Functions (variadic) (2)

> **Why skipped:** Functions with variable argument counts `...` (`TraceLog`, `TextFormat`). They lack a fixed C ABI signature for direct FFI binding.

<details>
<summary><b>List of skipped functions (2)</b></summary>

- [ ] `TraceLog`
- [ ] `TextFormat`

</details>

---

## 🛠️ Build & Development

### Building the Library and Demo Application

Cross-platform build (Linux, macOS, Windows):
```sh
bun run build
# or directly with bun:
bun tools/build.ts
```

On POSIX systems (macOS / Linux):
```sh
./build.sh
```

On Windows (PowerShell):
```powershell
.\build.ps1
```

Build pipeline:
1. Automatically discovers `raylib.h` (via `pkg-config`, standard system paths across Linux/macOS/Windows, or local `assets/include`).
2. Generates TS bindings, C shim, and FFI manifest into `gen/`.
3. Compiles C wrapper `gen/raylib_shim.c` into static library `gen/libraylib_shim.a`.
4. Compiles binary via `scriptc build demo/main.ts --ffi gen/raylib_ffi.json -o demo/demo`.

### Running the Demo

```sh
# macOS / Linux:
./demo/demo

# Windows:
.\demo\demo.exe
```

### Running Examples

The `examples/` directory contains usage examples:
- `shapes.ts` — 2D shapes, gradients, circles, rectangles.
- `shapes3d.ts` — 3D primitives (cubes, spheres, cylinders, plane).
- `index.ts` — Interactive window, mouse, keyboard, and FPS demo.
- `audio.ts` — Sound and music playback.
- `fonts.ts` — Fonts and text formatting.
- `textures.ts` — Texture loading and rendering.
- `models.ts` — 3D model loading.
- `shader.ts` — Custom shader effects.
- `image.ts` — Image generation and procedural drawing.
- `camera.ts` — 3D camera modes (Orbital, Free, FPS, Third Person).
- `breakout.ts` — Classic Breakout arcade game (score, combos, particles, lives).
- `instancing.ts` — Mesh instancing with custom matrix arrays.

Compile any example with:
```sh
LIBRARY_PATH="$(pkg-config --variable=libdir raylib)" scriptc build examples/shapes3d.ts --ffi gen/raylib_ffi.json -o examples/shapes3d
./examples/shapes3d
```

Or via the runner script:
```sh
bun run example shapes3d
```

### Verification & Testing

```sh
bun run typecheck        # tsc --noEmit across src/, gen/, tools/, demo/, examples/
bun run test:coverage    # asserts all examples and demo compile 100% statically
bun run test:package     # npm pack → install → build game from tarball
bun run test             # typecheck + both tests
```

`test:package` is the critical test: it installs the unpacked tarball into an isolated directory, builds a game from it, and verifies the manifest contains no machine-dependent paths. This catches regressions where a package works locally in the repository but fails on any other machine.

CI (`.github/workflows/ci.yml`) runs typecheck, `gen/` freshness checks, static coverage, and package tests on macOS, Linux, and Windows.

---

## 📄 License

zlib License — matching raylib's original license. See [LICENSE](LICENSE).
