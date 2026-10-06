import { Raylib, COLORS, KEYS } from "../src";
import { join } from "path";
import { existsSync } from "fs";

Raylib.initWindow(1200, 800, "Image Demo");
Raylib.setTargetFPS(60);

const texDir = existsSync("assets/textures") ? "assets/textures" : "../assets/textures";
const baseImage = Raylib.loadTexture(join(texDir, "texture_01.png"));

let imgWidth = 200;
let imgHeight = 200;

function createProceduralImage(): Uint8Array {
  const img = Raylib.genImageColor(imgWidth, imgHeight, COLORS.DARKGRAY);
  Raylib.imageDrawRectangle(img, 10, 10, imgWidth - 20, imgHeight - 20, COLORS.MAROON);
  Raylib.imageDrawCircle(img, Math.floor(imgWidth / 2), Math.floor(imgHeight / 2), 30, COLORS.GREEN);
  Raylib.imageDrawLine(img, 0, 0, imgWidth, imgHeight, COLORS.BLUE);
  Raylib.imageDrawLine(img, imgWidth, 0, 0, imgHeight, COLORS.BLUE);
  Raylib.imageDrawText(img, "Image!", 40, Math.floor(imgHeight / 2) - 10, 24, COLORS.WHITE);
  return img;
}

let currentImg = createProceduralImage();
let tex = Raylib.loadTextureFromImage(currentImg);

let rotate = 0;
let filter = 0;
const filterNames = ["POINT", "BILINEAR", "TRILINEAR"];

while (!Raylib.windowShouldClose()) {
  const dt = Raylib.getFrameTime();

  if (Raylib.isKeyPressed(KEYS.R)) {
    Raylib.unloadImage(currentImg);
    Raylib.unloadTexture(tex);
    currentImg = createProceduralImage();
    tex = Raylib.loadTextureFromImage(currentImg);
    Raylib.setTextureFilter(tex, filter);
  }

  if (Raylib.isKeyPressed(KEYS.F)) {
    filter = (filter + 1) % 3;
    Raylib.setTextureFilter(tex, filter);
  }

  if (Raylib.isKeyDown(KEYS.LEFT)) rotate = (rotate - 60 * dt) % 360;
  if (Raylib.isKeyDown(KEYS.RIGHT)) rotate = (rotate + 60 * dt) % 360;

  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.BLACK);

  const hw = imgWidth / 2;
  const hh = imgHeight / 2;

  // Draw procedural texture with rotation
  Raylib.drawTexturePro(
    tex,
    { x: 0, y: 0, width: imgWidth, height: imgHeight },
    { x: 150, y: 150, width: imgWidth, height: imgHeight },
    { x: hw, y: hh },
    rotate,
    COLORS.WHITE,
  );

  // Draw loaded baseImage (texture_01.png)
  Raylib.drawTextureEx(baseImage, { x: 300, y: 50 }, 0, 0.25, COLORS.WHITE);
  Raylib.drawText("texture_01.png", 300, 315, 16, COLORS.LIGHTGRAY);

  // Multiple small preview instances
  Raylib.drawTexturePro(
    tex,
    { x: 0, y: 0, width: imgWidth, height: imgHeight },
    { x: 50 + hw / 2, y: 380 + hh / 2, width: imgWidth / 2, height: imgHeight / 2 },
    { x: hw / 2, y: hh / 2 },
    rotate,
    COLORS.WHITE,
  );
  Raylib.drawTexturePro(
    tex,
    { x: 0, y: 0, width: imgWidth, height: imgHeight },
    { x: 180 + hw / 2, y: 380 + hh / 2, width: imgWidth / 2, height: imgHeight / 2 },
    { x: hw / 2, y: hh / 2 },
    -rotate,
    COLORS.WHITE,
  );
  Raylib.drawTexturePro(
    tex,
    { x: 0, y: 0, width: imgWidth, height: imgHeight },
    { x: 310 + hw / 2, y: 380 + hh / 2, width: imgWidth / 2, height: imgHeight / 2 },
    { x: hw / 2, y: hh / 2 },
    rotate * 2,
    COLORS.WHITE,
  );

  let y = 10;
  Raylib.drawText("IMAGE DEMO", 600, y, 28, COLORS.GOLD); y += 40;
  Raylib.drawText(`Image: ${imgWidth}x${imgHeight} (Procedural RGBA)`, 600, y, 18, COLORS.WHITE); y += 25;
  Raylib.drawText(`Base texture: ${baseImage.width}x${baseImage.height}`, 600, y, 18, COLORS.WHITE); y += 25;
  Raylib.drawText(`Rotation: ${rotate.toFixed(0)}deg`, 600, y, 18, COLORS.CYAN); y += 25;
  Raylib.drawText(`Filter: ${filterNames[filter]}`, 600, y, 18, COLORS.LIME); y += 35;
  Raylib.drawText("[R] Reset image", 600, y, 16, COLORS.LIGHTGRAY); y += 22;
  Raylib.drawText("[F] Cycle filter", 600, y, 16, COLORS.LIGHTGRAY); y += 22;
  Raylib.drawText("[Left/Right] Rotate", 600, y, 16, COLORS.LIGHTGRAY);

  Raylib.drawFPS(Raylib.getScreenWidth() - 100, 10);
  Raylib.endDrawing();
}

Raylib.unloadTexture(tex);
if (currentImg) Raylib.unloadImage(currentImg);
Raylib.unloadTexture(baseImage);
Raylib.closeWindow();
