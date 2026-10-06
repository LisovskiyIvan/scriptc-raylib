import {
  Raylib,
  COLORS,
  KEYS,
  CAMERA,
  MATERIAL_MAP_ALBEDO,
  DrawMeshInstanced,
  CheckCollisionLines,
  LoadImageFromMemory,
  ConfigFlags,
} from "../src";
import type { Camera3D, Matrix, Vector2 } from "../src/types";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const SCREEN_WIDTH = 1200;
const SCREEN_HEIGHT = 800;

Raylib.setConfigFlags(ConfigFlags.FLAG_MSAA_4X_HINT | ConfigFlags.FLAG_WINDOW_RESIZABLE);
Raylib.initWindow(SCREEN_WIDTH, SCREEN_HEIGHT, "Mesh Instancing & Intersection Demo");
Raylib.setTargetFPS(60);

const camera: Camera3D = {
  position: { x: 30.0, y: 25.0, z: 30.0 },
  target: { x: 0.0, y: 0.0, z: 0.0 },
  up: { x: 0.0, y: 1.0, z: 0.0 },
  fovy: 45.0,
  projection: CAMERA.PERSPECTIVE,
};

// 1. Load texture from memory buffer
const assetDir = existsSync("assets") ? "assets" : "../assets";
const texturePath = join(assetDir, "textures/texture_01.png");
let texture = Raylib.loadTextureFromImage(Raylib.genImageChecked(64, 64, 8, 8, COLORS.GOLD, COLORS.DARKBLUE));

if (existsSync(texturePath)) {
  const fileBytes = readFileSync(texturePath);
  const memImage = LoadImageFromMemory(".png", fileBytes);
  const memTex = Raylib.loadTextureFromImage(memImage);
  Raylib.unloadImage(memImage);
  Raylib.unloadTexture(texture);
  texture = memTex;
}

// 2. Prepare mesh and material
const cubeMesh = Raylib.genMeshCube(0.8, 0.8, 0.8);
const material = Raylib.loadMaterialDefault();
Raylib.setMaterialTexture(material, MATERIAL_MAP_ALBEDO, texture);

// 3. Grid settings for instances
const GRID_SIZE = 25; // 25x25 = 625 instances
const INSTANCE_COUNT = GRID_SIZE * GRID_SIZE;
const SPACING = 1.4;
const transforms = new Float32Array(INSTANCE_COUNT * 16);

let angle = 0;
let time = 0;
let autoRotate = true;

// 2D Line intersection test points
const barrierStart: Vector2 = { x: 100, y: 700 };
const barrierEnd: Vector2 = { x: 500, y: 650 };

while (!Raylib.windowShouldClose()) {
  const dt = Raylib.getFrameTime();
  time += dt;

  if (Raylib.isKeyPressed(KEYS.SPACE)) autoRotate = !autoRotate;

  if (autoRotate) {
    angle += dt * 0.4;
  }
  if (Raylib.isKeyDown(KEYS.LEFT)) angle -= dt * 1.5;
  if (Raylib.isKeyDown(KEYS.RIGHT)) angle += dt * 1.5;

  const radius = 35.0;
  camera.position.x = radius * Math.cos(angle);
  camera.position.z = radius * Math.sin(angle);

  // Update instance transforms (wave animation)
  let idx = 0;
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const posX = (x - GRID_SIZE / 2) * SPACING;
      const posZ = (z - GRID_SIZE / 2) * SPACING;
      const dist = Math.sqrt(posX * posX + posZ * posZ);
      const posY = Math.sin(dist * 0.4 - time * 3.0) * 2.0;

      // Identity matrix with translation (posX, posY, posZ)
      const offset = idx * 16;
      transforms[offset + 0] = 1.0;
      transforms[offset + 1] = 0.0;
      transforms[offset + 2] = 0.0;
      transforms[offset + 3] = posX;

      transforms[offset + 4] = 0.0;
      transforms[offset + 5] = 1.0;
      transforms[offset + 6] = 0.0;
      transforms[offset + 7] = posY;

      transforms[offset + 8] = 0.0;
      transforms[offset + 9] = 0.0;
      transforms[offset + 10] = 1.0;
      transforms[offset + 11] = posZ;

      transforms[offset + 12] = 0.0;
      transforms[offset + 13] = 0.0;
      transforms[offset + 14] = 0.0;
      transforms[offset + 15] = 1.0;

      idx++;
    }
  }

  // 2D ray from fixed origin towards mouse cursor
  const mouse = Raylib.getMousePosition();
  const rayOrigin: Vector2 = { x: 300, y: 780 };
  const intersection = CheckCollisionLines(rayOrigin, mouse, barrierStart, barrierEnd);

  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.BLACK);

  // Render 3D instanced meshes
  Raylib.beginMode3D(camera);
  Raylib.drawGrid(40, 2);
  DrawMeshInstanced(cubeMesh, material, transforms, INSTANCE_COUNT);
  Raylib.endMode3D();

  // 2D Overlay: Collision intersection demo
  Raylib.drawRectangle(20, 580, 520, 200, { r: 20, g: 25, b: 35, a: 220 });
  Raylib.drawRectangleLines(20, 580, 520, 200, COLORS.DARKBLUE);
  Raylib.drawText("2D Line Collision (CheckCollisionLines)", 35, 595, 16, COLORS.RAYWHITE);

  // Draw barrier line
  Raylib.drawLineEx(barrierStart, barrierEnd, 3, COLORS.GOLD);
  Raylib.drawCircleV(barrierStart, 4, COLORS.YELLOW);
  Raylib.drawCircleV(barrierEnd, 4, COLORS.YELLOW);

  // Draw laser line from rayOrigin to mouse
  Raylib.drawLineEx(rayOrigin, mouse, 2, intersection.collision ? COLORS.RED : COLORS.LIME);
  Raylib.drawCircleV(rayOrigin, 4, COLORS.GREEN);

  if (intersection.collision) {
    Raylib.drawCircleV(intersection.point, 7, COLORS.RED);
    Raylib.drawCircleLines(
      Math.floor(intersection.point.x),
      Math.floor(intersection.point.y),
      12 + Math.sin(time * 8) * 3,
      COLORS.YELLOW
    );
    Raylib.drawText(
      `Hit at: (${intersection.point.x.toFixed(1)}, ${intersection.point.y.toFixed(1)})`,
      35,
      620,
      14,
      COLORS.RED
    );
  } else {
    Raylib.drawText("Aim laser at yellow barrier line with mouse", 35, 620, 14, COLORS.GRAY);
  }

  // Stats & controls
  Raylib.drawRectangle(20, 20, 420, 130, { r: 15, g: 15, b: 20, a: 200 });
  Raylib.drawRectangleLines(20, 20, 420, 130, COLORS.DARKBLUE);
  Raylib.drawText("Raylib Instancing & Intersection Demo", 35, 30, 18, COLORS.RAYWHITE);
  Raylib.drawText(`Instances: ${INSTANCE_COUNT} cubes (single draw call)`, 35, 55, 14, COLORS.SKYBLUE);
  Raylib.drawText(`FPS: ${Raylib.getFPS()}`, 35, 75, 14, COLORS.GREEN);
  Raylib.drawText("[SPACE] Toggle camera rotation | [LEFT/RIGHT] Orbit", 35, 95, 13, COLORS.LIGHTGRAY);
  Raylib.drawText("[MOUSE] Aim 2D intersection laser", 35, 115, 13, COLORS.LIGHTGRAY);

  Raylib.endDrawing();
}

Raylib.unloadMaterial(material);
Raylib.unloadMesh(cubeMesh);
Raylib.unloadTexture(texture);
Raylib.closeWindow();
