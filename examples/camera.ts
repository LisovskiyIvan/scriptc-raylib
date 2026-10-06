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
  [CAMERA.FIRST_PERSON]: "FIRST PERSON (WASD + Mouse)",
  [CAMERA.THIRD_PERSON]: "THIRD PERSON (WASD + Mouse)",
};

while (!Raylib.windowShouldClose()) {
  // Mode selection
  if (Raylib.isKeyPressed(KEYS.ONE)) {
    cameraMode = CAMERA.ORBITAL;
    camera.position = { x: 10.0, y: 10.0, z: 10.0 };
    camera.target = { x: 0.0, y: 0.0, z: 0.0 };
  }
  if (Raylib.isKeyPressed(KEYS.TWO)) {
    cameraMode = CAMERA.FREE;
    camera.position = { x: 10.0, y: 10.0, z: 10.0 };
    camera.target = { x: 0.0, y: 0.0, z: 0.0 };
  }
  if (Raylib.isKeyPressed(KEYS.THREE)) {
    cameraMode = CAMERA.FIRST_PERSON;
    camera.position = { x: 0.0, y: 2.0, z: 8.0 };
    camera.target = { x: 0.0, y: 2.0, z: 0.0 };
  }
  if (Raylib.isKeyPressed(KEYS.FOUR)) {
    cameraMode = CAMERA.THIRD_PERSON;
    camera.position = { x: 0.0, y: 4.0, z: 10.0 };
    camera.target = { x: 0.0, y: 1.0, z: 0.0 };
  }

  // Update camera state via native raylib UpdateCamera
  Raylib.updateCamera(camera, cameraMode);

  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.BLACK);

  Raylib.beginMode3D(camera);

  // 3D Scene
  Raylib.drawGrid(20, 1.0);

  // Central structures
  Raylib.drawCube({ x: 0, y: 1, z: 0 }, 2, 2, 2, COLORS.RED);
  Raylib.drawCubeWires({ x: 0, y: 1, z: 0 }, 2, 2, 2, COLORS.MAROON);

  Raylib.drawSphere({ x: 0, y: 3.2, z: 0 }, 1.0, COLORS.GOLD);
  Raylib.drawSphereWires({ x: 0, y: 3.2, z: 0 }, 1.0, 16, 16, COLORS.ORANGE);

  // Four decorative pillars
  const pillarDist = 5.0;
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

  Raylib.endMode3D();

  // 2D Overlay HUD
  let y = 15;
  Raylib.drawText("3D CAMERA CONTROLS DEMO", 15, y, 26, COLORS.GOLD); y += 35;
  Raylib.drawText(`Current Mode: ${modeNames[cameraMode] ?? "CUSTOM"}`, 15, y, 20, COLORS.WHITE); y += 28;

  Raylib.drawText(
    `Pos: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}) | Target: (${camera.target.x.toFixed(1)}, ${camera.target.y.toFixed(1)}, ${camera.target.z.toFixed(1)})`,
    15,
    y,
    18,
    COLORS.CYAN,
  );
  y += 35;

  Raylib.drawText("[1] Orbital Mode", 15, y, 16, cameraMode === CAMERA.ORBITAL ? COLORS.YELLOW : COLORS.LIGHTGRAY); y += 22;
  Raylib.drawText("[2] Free Camera", 15, y, 16, cameraMode === CAMERA.FREE ? COLORS.YELLOW : COLORS.LIGHTGRAY); y += 22;
  Raylib.drawText("[3] First Person", 15, y, 16, cameraMode === CAMERA.FIRST_PERSON ? COLORS.YELLOW : COLORS.LIGHTGRAY); y += 22;
  Raylib.drawText("[4] Third Person", 15, y, 16, cameraMode === CAMERA.THIRD_PERSON ? COLORS.YELLOW : COLORS.LIGHTGRAY); y += 30;

  Raylib.drawText("Controls:", 15, y, 18, COLORS.WHITE); y += 22;
  Raylib.drawText("- In Orbital: hold left/middle mouse button and drag to rotate", 15, y, 16, COLORS.GRAY); y += 20;
  Raylib.drawText("- In Free/FPS: use WASD / Arrow keys + Mouse to look around", 15, y, 16, COLORS.GRAY);

  Raylib.drawFPS(Raylib.getScreenWidth() - 100, 15);
  Raylib.endDrawing();
}

Raylib.closeWindow();
