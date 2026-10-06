# craylib — raylib bindings for scriptc

TypeScript-биндинги для [raylib 6.0](https://www.raylib.com), генерируемые из оригинального Си-заголовка
и линкуемые через нативный FFI [scriptc](https://scriptc.dev).

Никакого Node.js, V8 или JIT внутри — на выходе получается компактный, автономный статический исполняемый файл с прямой машинной скоростью.

---

## ⚡ Особенности

- **🚀 Нативная производительность**: Вызовы идут напрямую в библиотеку raylib по системному ABI без посредников.
- **📦 Готов к использованию как npm-пакет**: Удобные реэкспорты через `index.ts`, типы, манифест FFI и готовая библиотека-шим.
- **🎨 Встроенные цвета и константы**: Полная палитра `COLORS` (включая `RAYWHITE`, `RED`, `DARKGRAY` и др.), математические константы (`PI`, `DEG2RAD`, `RAD2DEG`) и удобные группы энумов (`KEYS`, `MOUSE`, `CAMERA`, `BLEND`).
- **🔄 Двойной стиль API**:
  - Прямые функции C-стиля (`InitWindow`, `BeginDrawing`, `ClearBackground`, `DrawCircle`).
  - Пространство имён `Raylib` с поддержкой camelCase (`Raylib.initWindow`, `Raylib.beginDrawing`, `Raylib.drawCircle`).
- **🛡️ 438 функций raylib**: 116 прямых скалярных вызовов + 322 обёрнутых через C-шим с проверками layout на этапе компиляции (`_Static_assert`).

---

## 🏗️ Как это устроено

```
raylib.h ──(tools/gen_bindings.ts)──► gen/raylib_ffi.json   манифест FFI (format 6)
                                  ├─► gen/raylib_shim.c     C-обёртки ──► libraylib_shim.a
                                  ├─► gen/raylib_ffi.ts     сырые declare rl_*
                                  └─► gen/raylib.ts         типизированный API + енумы + структуры
                                        │
                                        ▼
                                     src/index.ts           реэкспорты, COLORS, KEYS, Raylib
                                        │
demo/main.ts ──(scriptc build --ffi)───┴──────────────────► demo/demo (нативный бинарник)
```

Генератор классифицирует каждую из 600 функций raylib:

1. **direct (116)** — сигнатура состоит только из скаляров: линкуется напрямую на оригинальный символ raylib без C-кода.
2. **wrapped (322)** — функции, требующие Си-шима:
   - `const char*` → класс `string` (ptr + len): шим копирует в NUL-terminated буфер;
   - структуру по значению с одними скалярами (`Vector2`, `Color`, `Camera3D`, `Texture`, `Matrix`...) → разворачивается в отдельные скалярные аргументы, шим собирает структуру композитным литералом;
   - структуру с указателями внутри (`Image`, `Sound`, `Music`, `Shader`, `Model`...) → TS держит `Uint8Array` с байтами структуры и передаёт буфером (класс `bytes`), шим делает memcpy;
   - возврат структуры → шим копирует её в хвостовой out-буфер `Uint8Array` (класс `mutable-bytes`), TS читает поля через `DataView` по офсетам, проверенным `_Static_assert(sizeof(...))`;
   - строковые возвраты (`GetMonitorName`, `GetClipboardText`, `GetGamepadName`) → через буфер `mutable-bytes` с раскодированием через `TextDecoder`;
   - массивы вершин (`DrawLineStrip`, `DrawTriangleFan`, `DrawTriangleStrip`, `DrawSpline*`, `DrawTriangleStrip3D`) → через байтовые буферы `Float32Array | Uint8Array | Vector2[]/Vector3[]`.
3. **skipped (162)** — функции, не поддерживаемые архитектурой FFI (см. подробный разбор ниже).

---

## 📦 Установка и настройка

### Предварительные требования

1. **raylib 5.5 / 6.0**:
   - **macOS**: `brew install raylib` (или MacPorts: `sudo port install raylib`)
   - **Linux (Ubuntu/Debian)**: `sudo apt install libraylib-dev`
   - **Linux (Arch Linux)**: `sudo pacman -S raylib`
   - **Linux (Fedora)**: `sudo dnf install raylib-devel`
   - **Windows**: MSYS2 (`pacman -S mingw-w64-x86_64-raylib`), vcpkg (`vcpkg install raylib:x64-windows`), официальный инсталлятор [raylib Windows Installer](https://www.raylib.com) или заголовок из `assets/include/raylib.h`.
2. Компилятор **scriptc** (версия 0.2.3 или новее).
3. **Bun** (для кодогенерации и кроссплатформенной сборки).

### Использование в проекте

```sh
npm install craylib
# или
bun add craylib
```

---

## 🚀 Примеры использования

### Вариант 1. Прямой импорт функций (рекомендуется)

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
} from "craylib";

InitWindow(800, 450, "craylib demo");

while (!WindowShouldClose()) {
  if (IsKeyDown(KEY_ESCAPE)) break;

  BeginDrawing();
  ClearBackground(COLORS.DARKGRAY);
  DrawText("Привет из craylib!", 100, 200, 24, COLORS.RAYWHITE);
  DrawFPS(10, 10);
  EndDrawing();
}

CloseWindow();
```

### Вариант 2. Через объект `Raylib` и camelCase

```ts
import { Raylib, COLORS, KEYS } from "craylib";

Raylib.initWindow(800, 450, "craylib demo");
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

### 🎮 Запуск примеров (Examples)

В репозитории доступны 9 готовых примеров в папке `examples/`:
`index`, `shapes`, `shapes3d`, `textures`, `fonts`, `audio`, `models`, `shader`, `image`.

Так как `scriptc` является AOT-компилятором, нативный FFI-манифест передаётся компилятору через флаг `--ffi`:

```sh
# Напрямую через scriptc run:
scriptc run examples/index.ts --ffi gen/raylib_ffi.json

# Либо через удобный раннер (автоматически подтягивает --ffi):
bun run example index
bun run example shapes

# Либо сборка в автономный бинарник:
scriptc build examples/shapes.ts --ffi gen/raylib_ffi.json -o examples/shapes
./examples/shapes
```

### Настройка пути к raylib: `Raylib.config`

Функция `Raylib.config` (принимает опции интерфейса `RaylibConfig`) позволяет явно задать путь к библиотеке raylib или выполнить автопоиск:

```ts
import { Raylib } from "craylib";

// Ручной путь (Linux, macOS или Windows):
Raylib.config({
  raylibPath: "/opt/homebrew/lib/libraylib.dylib",
});

// Или автоматический поиск:
Raylib.config({ raylibPath: "auto" });
```

При указании `raylibPath` манифест `gen/raylib_ffi.json` автоматически настраивается на указанный путь, позволяя линкеру `scriptc` находить библиотеку без дополнительных переменных окружения.

---

## 💡 Управление памятью и отсутствие лимитов на ассеты

В отличие от подходов с фиксированными статическими реестрами (где использовались `MAX_MODELS 64`, `MAX_IMAGES 128`, `MAX_SOUNDS 32` и т.д.):

- **В `craylib` лимитов нет:** Каждая сложная структура raylib (`Model`, `Image`, `Sound`, `Music`, `Shader`, `Font`, `Wave`, `Mesh`, `Material`) представлена независимым буфером `Uint8Array` точного размера `sizeof(Struct)`.
- **Прямой round-trip:** При вызове `LoadModel()` Си-шим копирует нативную структуру в свежевыделенный `Uint8Array`. В TS вы владеете этим дескриптором напрямую. При передаче в функции отрисовки буфер байтов передаётся обратно в C без промежуточных таблиц поиска.
- **Масштабируемость:** Можно загрузить сотни тысяч моделей, текстур или звуков — ограничением выступает только физическая оперативная память системы.


## 📊 Статус реализации функций

Всего в заголовке raylib 6.0 содержится **600 функций**:
- **438 функций реализованы** (116 direct + 322 wrapped) — **73.0%**
- **162 функции исключены** по архитектурным причинам FFI — **27.0%**

### Сводная таблица по модулям

| Модуль | Реализовано | Пропущено | Всего | Прогресс |
|---|:---:|:---:|:---:|:---:|
| **Core / Window & Graphics Device** | 124 | 45 | 169 | 73% |
| **Input Handling (Keyboard, Mouse, Gamepad)** | 38 | 1 | 39 | 97% |
| **Gestures & Touch** | 8 | 0 | 8 | 100% |
| **Camera System** | 0 | 2 | 2 | 0% |
| **2D Shapes & Splines** | 67 | 2 | 69 | 97% |
| **Textures & Images** | 55 | 60 | 115 | 48% |
| **Fonts & Text** | 27 | 32 | 59 | 46% |
| **3D Shapes Drawing** | 21 | 0 | 21 | 100% |
| **3D Models & Materials** | 43 | 9 | 52 | 83% |
| **Audio & Music** | 55 | 11 | 66 | 83% |
| **ИТОГО** | **438** | **162** | **600** | **73%** |

---

## ✅ Реализованные функции (438)

Каждая функция полностью типизирована, проверена и доступна для вызова как в PascalCase, так и в camelCase.


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

## 🚫 Функции, которые мы не будем делать (178)

Ниже перечислены все исключённые функции, сгруппированные по причинам исключения с подробным объяснением.


### Модификация структур по указателю (struct-pointer) (74)

> **Почему не делаем:** Функции принимают изменяемый указатель на C-структуру (`Image*`, `Camera3D*`, `Mesh*`, `Material*`, `Wave*`) для мутации in-place, либо массивы вершин/точек (`Vector2*` в `DrawLineStrip`, `DrawTriangleStrip`, `DrawSpline*`). В FFI scriptc структуры передаются по значению через распакованные скалярные поля или через opaque буферы `Uint8Array`. Передача мутабельных указателей внутрь структур scriptc не поддерживается.

<details>
<summary><b>Список пропущенных функций (74)</b></summary>

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

### Файловые операции ОС (file-io) (26)

> **Почему не делаем:** Прямые вызовы функций работы с файловой системой ОС (`FileExists`, `DirectoryExists`, `LoadFileData`, `SaveFileText`, `ExportImage`, `GetFileName`, `GetDirectoryPath` и др.). Управление файловой системой и путями является задачей стандартных средств рантайма/ОС. **Ресурсные лоадеры сохранены:** `LoadTexture`, `LoadSound`, `LoadMusicStream`, `LoadFont`, `LoadModel`, `LoadShader` работают штатно.

<details>
<summary><b>Список пропущенных функций (26)</b></summary>

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

### Возврат C-строк (string-return) (23)

> **Почему не делаем:** Функции возвращают `const char*` / `char*` (`GetClipboardText`, `GetMonitorName`, `GetGamepadName`, утилиты `TextToUpper`, `TextToLower` и др.). Возврат динамически выделенных C-строк без чёткого контракта владения памятью (кто и когда вызывает `free`) приводит к утечкам памяти или висячим указателям.

<details>
<summary><b>Список пропущенных функций (23)</b></summary>

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

### Возврат сырых указателей (pointer-return) (18)

> **Почему не делаем:** Функции возвращают нетипизированные указатели (`void*`, `Color*`, `char**`, `Transform**` — например, `GetWindowHandle`, `LoadImageColors`, `LoadFontData`, `TextSplit`, `LoadMaterials`). В типизированном коде TS такие указатели не могут безопасно разыменовываться без информации о размере и структуре буфера.

<details>
<summary><b>Список пропущенных функций (18)</b></summary>

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

### Параметры-указатели на память/счётчики (pointer-param) (17)

> **Почему не делаем:** Функции требуют передачи указателей на выходные переменные или сырые блоки памяти (`int* count`, `void* data` — например, `LoadImageAnim`, `DrawTextCodepoints`, `GetCodepoint`, `UnloadWaveSamples`).

<details>
<summary><b>Список пропущенных функций (17)</b></summary>

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

### C-колбэки (callback) (10)

> **Почему не делаем:** Функции принимают C-указатели на функции обратного вызова (`SetAudioStreamCallback`, `SetTraceLogCallback`, `AttachAudioStreamProcessor` и др.). Вызов из нативного C обратно в исполняемый контекст TypeScript в рамках статического FFI scriptc не поддерживается.

<details>
<summary><b>Список пропущенных функций (10)</b></summary>

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

### Изменяемые байтовые указатели (mutable-pointer) (5)

> **Почему не делаем:** Функции требуют изменяемых параметров `void*` или `char*` без информации о длине буфера (`GetPixelColor`, `SetPixelColor`, `TextCopy`, `TextAppend`, `UnloadUTF8`).

<details>
<summary><b>Список пропущенных функций (5)</b></summary>

- [ ] `GetPixelColor`
- [ ] `SetPixelColor`
- [ ] `UnloadUTF8`
- [ ] `TextCopy`
- [ ] `TextAppend`

</details>

### Ручное управление памятью C (manual-memory) (3)

> **Почему не делаем:** Низкоуровневые функции аллокатора C (`MemAlloc`, `MemRealloc`, `MemFree`). В TypeScript ручное выделение памяти небезопасно и не требуется.

<details>
<summary><b>Список пропущенных функций (3)</b></summary>

- [ ] `MemAlloc`
- [ ] `MemRealloc`
- [ ] `MemFree`

</details>

### Вариадические функции C (variadic) (2)

> **Почему не делаем:** Функции с переменным числом аргументов `...` (`TraceLog`, `TextFormat`). Они не имеют фиксированной сигнатуры C ABI для прямого FFI связывания.

<details>
<summary><b>Список пропущенных функций (2)</b></summary>

- [ ] `TraceLog`
- [ ] `TextFormat`

</details>

---

## 🛠️ Сборка и разработка

### Сборка библиотеки и демонстрационного приложения

Кроссплатформенная сборка (Linux, macOS, Windows):
```sh
bun run build
# или напрямую через bun:
bun tools/build.ts
```

На POSIX-системах (macOS / Linux):
```sh
./build.sh
```

На Windows (PowerShell):
```powershell
.\build.ps1
```

Скрипт сборки:
1. Автоматически находит заголовок `raylib.h` (через `pkg-config`, стандартные системные пути Linux/macOS/Windows или локальные `assets/include`).
2. Генерирует TS-биндинги, C-шим и манифест FFI в `gen/`.
3. Компилирует Си-обёртку `gen/raylib_shim.c` в статическую библиотеку `gen/libraylib_shim.a`.
4. Собирает бинарник через `scriptc build demo/main.ts --ffi gen/raylib_ffi.json -o demo/demo`.

### Запуск демо

```sh
# macOS / Linux:
./demo/demo

# Windows:
.\demo\demo.exe
```

### Запуск примеров

В папке `examples/` собраны примеры использования:
- `shapes.ts` — Рисование 2D фигур, градиентов, кругов, прямоугольников.
- `shapes3d.ts` — 3D примитивы (кубы, сферы, цилиндры, плоскость).
- `index.ts` — Интерактивное демо окна, мыши, клавиатуры и FPS.
- `audio.ts` — Воспроизведение звука и музыки.
- `fonts.ts` — Шрифты и форматирование текста.
- `textures.ts` — Загрузка и рендеринг текстур.
- `models.ts` — Загрузка 3D моделей.
- `shader.ts` — Работа с шейдерами.
- `image.ts` — Генерация изображений.

Собрать любой пример можно командой:
```sh
LIBRARY_PATH="$(pkg-config --variable=libdir raylib)" scriptc build examples/shapes3d.ts --ffi gen/raylib_ffi.json -o examples/shapes3d
./examples/shapes3d
```

---

## 📄 Лицензия

zlib License — соответствует оригинальной лицензии raylib. См. файл [LICENSE](file:///Users/ivan/dev/myself/craylib/LICENSE).
