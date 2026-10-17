import { Raylib, COLORS, KEYS, type Vector2 } from "../src";

const screenWidth = 960;
const screenHeight = 600;

Raylib.initWindow(screenWidth, screenHeight, "raylib 6.2 Outlines & Shapes Demo");
Raylib.setTargetFPS(60);

let thickness = 4.0;
let rotation = 0.0;
let rotating = true;
let lastKey: number = KEYS.SPACE;
let lastKeyName = "SPACE";

while (!Raylib.windowShouldClose()) {
  const dt = Raylib.getFrameTime();

  if (Raylib.isKeyDown(KEYS.UP)) {
    thickness += 4.0 * dt;
    if (thickness > 20.0) thickness = 20.0;
  }
  if (Raylib.isKeyDown(KEYS.DOWN)) {
    thickness -= 4.0 * dt;
    if (thickness < 1.0) thickness = 1.0;
  }

  if (Raylib.isKeyPressed(KEYS.SPACE)) {
    rotating = !rotating;
  }

  const pressedKey = Raylib.getKeyPressed();
  if (pressedKey !== 0) {
    lastKey = pressedKey;
    const name = Raylib.getKeyName(pressedKey);
    lastKeyName = name.length > 0 ? name : `#${pressedKey}`;
  }

  if (rotating) {
    rotation += 45.0 * dt;
    if (rotation >= 360.0) rotation -= 360.0;
  }

  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.DARKGRAY);

  // Header info
  Raylib.drawText("raylib 6.2 Feature Showcase: Draw*LinesEx & Gradient API", 20, 20, 22, COLORS.RAYWHITE);
  Raylib.drawText(
    `[UP/DOWN] Line Thickness: ${Math.floor(thickness * 10) / 10} px  |  [SPACE] Rotation: ${rotating ? "ON" : "OFF"}`,
    20,
    52,
    16,
    COLORS.LIGHTGRAY,
  );
  Raylib.drawText(
    `Last Key Pressed (via GetKeyName): ${lastKeyName}`,
    20,
    76,
    16,
    COLORS.YELLOW,
  );

  // Row 1: Shapes with new Draw*LinesEx functions
  // 1. Circle with DrawCircleLinesEx
  const c1: Vector2 = { x: 140, y: 200 };
  Raylib.drawCircleV(c1, 55, COLORS.DARKBLUE);
  Raylib.drawCircleLinesEx(c1, 55, thickness, COLORS.SKYBLUE);
  Raylib.drawText("CircleLinesEx", 85, 275, 15, COLORS.WHITE);

  // 2. Circle Sector with DrawCircleSectorLinesEx
  const c2: Vector2 = { x: 380, y: 200 };
  Raylib.drawCircleSector(c2, 55, rotation, rotation + 120, 36, COLORS.MAROON);
  Raylib.drawCircleSectorLinesEx(c2, 55, rotation, rotation + 120, 36, thickness, COLORS.ORANGE);
  Raylib.drawText("CircleSectorLinesEx", 310, 275, 15, COLORS.WHITE);

  // 3. Ellipse with DrawEllipseLinesEx
  const c3: Vector2 = { x: 620, y: 200 };
  Raylib.drawEllipse(Math.floor(c3.x), Math.floor(c3.y), 70, 45, COLORS.DARKGREEN);
  Raylib.drawEllipseLinesEx(c3, 70, 45, thickness, COLORS.LIME);
  Raylib.drawText("EllipseLinesEx", 570, 275, 15, COLORS.WHITE);

  // 4. Ring with DrawRingLinesEx
  const c4: Vector2 = { x: 840, y: 200 };
  Raylib.drawRing(c4, 30, 55, rotation, rotation + 240, 36, COLORS.DARKPURPLE);
  Raylib.drawRingLinesEx(c4, 30, 55, rotation, rotation + 240, 36, thickness, COLORS.MAGENTA);
  Raylib.drawText("RingLinesEx", 795, 275, 15, COLORS.WHITE);

  // Row 2: Triangles and Gradients
  // 5. DrawTriangleGradient (New 6.2 function)
  const tv0: Vector2 = { x: 140, y: 350 };
  const tv1: Vector2 = { x: 70, y: 470 };
  const tv2: Vector2 = { x: 210, y: 470 };
  Raylib.drawTriangleGradient(tv0, tv1, tv2, COLORS.RED, COLORS.GREEN, COLORS.BLUE);
  Raylib.drawTriangleLinesEx(tv0, tv1, tv2, thickness, COLORS.WHITE);
  Raylib.drawText("TriangleGradient + LinesEx", 40, 490, 15, COLORS.WHITE);

  // 6. RectangleLinesEx
  const rec = { x: 300, y: 360, width: 160, height: 110 };
  Raylib.drawRectangleRec(rec, COLORS.GOLD);
  Raylib.drawRectangleLinesEx(rec, thickness, COLORS.BROWN);
  Raylib.drawText("RectangleLinesEx", 325, 490, 15, COLORS.WHITE);

  // 7. PolyLinesEx
  const polyCenter: Vector2 = { x: 620, y: 415 };
  Raylib.drawPoly(polyCenter, 6, 60, rotation, COLORS.DARKBLUE);
  Raylib.drawPolyLinesEx(polyCenter, 6, 60, rotation, thickness, COLORS.SKYBLUE);
  Raylib.drawText("PolyLinesEx (Hexagon)", 545, 490, 15, COLORS.WHITE);

  // 8. Custom spline/strip
  const stripPoints = new Float32Array([
    770, 450,
    810, 370,
    850, 450,
    890, 370,
    930, 430,
  ]);
  Raylib.drawLineStrip(stripPoints, COLORS.VIOLET);
  Raylib.drawText("LineStrip", 820, 490, 15, COLORS.WHITE);

  Raylib.drawFPS(screenWidth - 90, 20);
  Raylib.endDrawing();
}

Raylib.closeWindow();
