import { Raylib, COLORS, KEYS, CAMERA, type Camera3D } from "../src";

Raylib.initWindow(1200, 800, "3D Camera Modes Demo");
Raylib.setTargetFPS(60);

const camera: Camera3D = {
  position: { x: 10.0, y: 10.0, z: 10.0 },
  target: { x: 0.0, y: 0.0, z: 0.0 },
  up: { x: 0.0, y: 1.0, z: 0.0 },
  fovy: 45.0,
  projection: CAMERA.PERSPECTIVE,
};

let cameraMode: number = CAMERA.ORBITAL;
const modeNames: Record<number, string> = {
  [CAMERA.ORBITAL]: "ORBITAL (Mouse drag to orbit / Scroll to zoom)",
  [CAMERA.FREE]: "FREE (WASD to move, Mouse to look)",
  [CAMERA.FIRST_PERSON]: "FIRST PERSON (WASD to walk, Mouse to look)",
  [CAMERA.THIRD_PERSON]: "THIRD PERSON (WASD to move capsule, Mouse to orbit)",
};

function setCameraMode(mode: number): void {
  cameraMode = mode;
  if (mode === CAMERA.ORBITAL) {
    camera.position = { x: 10.0, y: 10.0, z: 10.0 };
    camera.target = { x: 0.0, y: 0.0, z: 0.0 };
    Raylib.enableCursor();
  } else if (mode === CAMERA.FREE) {
    camera.position = { x: 10.0, y: 10.0, z: 10.0 };
    camera.target = { x: 0.0, y: 0.0, z: 0.0 };
    Raylib.disableCursor();
  } else if (mode === CAMERA.FIRST_PERSON) {
    camera.position = { x: 0.0, y: 2.0, z: 8.0 };
    camera.target = { x: 0.0, y: 2.0, z: 0.0 };
    Raylib.disableCursor();
  } else if (mode === CAMERA.THIRD_PERSON) {
    // Start capsule at center of ground, camera behind and slightly above
    camera.target = { x: 0.0, y: 1.0, z: 0.0 };
    camera.position = { x: 0.0, y: 4.0, z: 8.0 };
    Raylib.disableCursor();
  }
}

setCameraMode(CAMERA.THIRD_PERSON);

while (!Raylib.windowShouldClose()) {
  // Mode selection
  if (Raylib.isKeyPressed(KEYS.ONE)) setCameraMode(CAMERA.ORBITAL);
  if (Raylib.isKeyPressed(KEYS.TWO)) setCameraMode(CAMERA.FREE);
  if (Raylib.isKeyPressed(KEYS.THREE)) setCameraMode(CAMERA.FIRST_PERSON);
  if (Raylib.isKeyPressed(KEYS.FOUR)) setCameraMode(CAMERA.THIRD_PERSON);

  // Toggle pointer lock with TAB or click to lock
  if (Raylib.isKeyPressed(KEYS.TAB)) {
    if (Raylib.isCursorHidden()) {
      Raylib.enableCursor();
    } else {
      Raylib.disableCursor();
    }
  }

  if (Raylib.isMouseButtonPressed(0) && cameraMode !== CAMERA.ORBITAL && !Raylib.isCursorHidden()) {
    Raylib.disableCursor();
  }

  // Update camera state via native raylib UpdateCamera
  Raylib.updateCamera(camera, cameraMode);

  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.BLACK);

  Raylib.beginMode3D(camera);

  // 3D Scene
  Raylib.drawGrid(20, 1.0);

  // Central structures
  Raylib.drawCube({ x: 0, y: 0.5, z: 0 }, 1.5, 1.0, 1.5, COLORS.MAROON);
  Raylib.drawCubeWires({ x: 0, y: 0.5, z: 0 }, 1.5, 1.0, 1.5, COLORS.RED);

  // Four decorative pillars
  const pillarDist = 6.0;
  const pillars = [
    { x: pillarDist, z: pillarDist, c: COLORS.BLUE },
    { x: -pillarDist, z: pillarDist, c: COLORS.LIME },
    { x: pillarDist, z: -pillarDist, c: COLORS.PURPLE },
    { x: -pillarDist, z: -pillarDist, c: COLORS.SKYBLUE },
  ];

  for (const p of pillars) {
    Raylib.drawCylinder({ x: p.x, y: 1.5, z: p.z }, 0.6, 0.6, 3.0, 16, p.c);
    Raylib.drawCylinderWires({ x: p.x, y: 1.5, z: p.z }, 0.6, 0.6, 3.0, 16, COLORS.WHITE);
  }

  // Third Person Character Capsule at camera.target
  if (cameraMode === CAMERA.THIRD_PERSON) {
    const charRadius = 0.45;
    const charBottom: { x: number; y: number; z: number } = {
      x: camera.target.x,
      y: camera.target.y - 0.4,
      z: camera.target.z,
    };
    const charTop: { x: number; y: number; z: number } = {
      x: camera.target.x,
      y: camera.target.y + 0.8,
      z: camera.target.z,
    };

    // Draw Capsule avatar
    Raylib.drawCapsule(charBottom, charTop, charRadius, 16, 8, COLORS.GOLD);
    Raylib.drawCapsuleWires(charBottom, charTop, charRadius, 16, 8, COLORS.YELLOW);

    // Direction indicator / Visor facing where camera is looking
    const fwdX = camera.target.x - camera.position.x;
    const fwdZ = camera.target.z - camera.position.z;
    const fwdLen = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ);
    if (fwdLen > 0.01) {
      const dx = fwdX / fwdLen;
      const dz = fwdZ / fwdLen;
      Raylib.drawSphere(
        { x: camera.target.x + dx * (charRadius - 0.05), y: camera.target.y + 0.5, z: camera.target.z + dz * (charRadius - 0.05) },
        0.18,
        COLORS.DARKBLUE,
      );
    }
  }

  Raylib.endMode3D();

  // 2D Overlay HUD
  let y = 15;
  Raylib.drawText("3D CAMERA CONTROLS DEMO", 15, y, 26, COLORS.GOLD); y += 35;
  Raylib.drawText(`Current Mode: ${modeNames[cameraMode] ?? "CUSTOM"}`, 15, y, 20, COLORS.WHITE); y += 28;

  const cursorLocked = Raylib.isCursorHidden();
  Raylib.drawText(
    `Cursor: ${cursorLocked ? "LOCKED (Hidden) [TAB to release]" : "UNLOCKED [TAB / Click to lock]"}`,
    15,
    y,
    18,
    cursorLocked ? COLORS.LIME : COLORS.ORANGE,
  );
  y += 26;

  Raylib.drawText(
    `Pos: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}) | Target: (${camera.target.x.toFixed(1)}, ${camera.target.y.toFixed(1)}, ${camera.target.z.toFixed(1)})`,
    15,
    y,
    16,
    COLORS.CYAN,
  );
  y += 32;

  Raylib.drawText("[1] Orbital Mode", 15, y, 16, cameraMode === CAMERA.ORBITAL ? COLORS.YELLOW : COLORS.LIGHTGRAY); y += 22;
  Raylib.drawText("[2] Free Camera", 15, y, 16, cameraMode === CAMERA.FREE ? COLORS.YELLOW : COLORS.LIGHTGRAY); y += 22;
  Raylib.drawText("[3] First Person", 15, y, 16, cameraMode === CAMERA.FIRST_PERSON ? COLORS.YELLOW : COLORS.LIGHTGRAY); y += 22;
  Raylib.drawText("[4] Third Person (Follows Capsule)", 15, y, 16, cameraMode === CAMERA.THIRD_PERSON ? COLORS.YELLOW : COLORS.LIGHTGRAY); y += 28;

  Raylib.drawText("Controls:", 15, y, 18, COLORS.WHITE); y += 22;
  if (cameraMode === CAMERA.THIRD_PERSON) {
    Raylib.drawText("- Use WASD or Arrow keys to WALK with capsule character", 15, y, 16, COLORS.LIGHTGRAY); y += 20;
    Raylib.drawText("- Move mouse to rotate camera around character, scroll to zoom", 15, y, 16, COLORS.LIGHTGRAY); y += 20;
  } else if (cameraMode === CAMERA.FIRST_PERSON || cameraMode === CAMERA.FREE) {
    Raylib.drawText("- Use WASD / Arrow keys to move camera, Mouse to look around", 15, y, 16, COLORS.LIGHTGRAY); y += 20;
  } else {
    Raylib.drawText("- Hold left/middle mouse button and drag to orbit, scroll to zoom", 15, y, 16, COLORS.LIGHTGRAY); y += 20;
  }
  Raylib.drawText("- Press [TAB] anytime to toggle cursor lock / release", 15, y, 16, COLORS.GRAY);

  Raylib.drawFPS(Raylib.getScreenWidth() - 100, 15);
  Raylib.endDrawing();
}

if (Raylib.isCursorHidden()) Raylib.enableCursor();
Raylib.closeWindow();
