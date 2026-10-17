import { Raylib, COLORS, KEYS, type Vector2 } from "../src";

const screenWidth = 800;
const screenHeight = 450;
const STAR_COUNT = 300;

Raylib.initWindow(screenWidth, screenHeight, "raylib [shapes] - starfield effect");
Raylib.setTargetFPS(60);

interface Star {
  x: number;
  y: number;
  z: number;
  screenX: number;
  screenY: number;
}

const stars: Star[] = [];

for (let i = 0; i < STAR_COUNT; i++) {
  stars.push({
    x: Raylib.getRandomValue(-Math.floor(screenWidth / 2), Math.floor(screenWidth / 2)),
    y: Raylib.getRandomValue(-Math.floor(screenHeight / 2), Math.floor(screenHeight / 2)),
    z: 1.0,
    screenX: 0,
    screenY: 0,
  });
}

let speed = 1.1;
let drawLines = true;

while (!Raylib.windowShouldClose()) {
  const mouseMove = Raylib.getMouseWheelMove();
  if (mouseMove !== 0) {
    speed += (2.0 * mouseMove) / 9.0;
    if (speed < 0.1) speed = 0.1;
    else if (speed > 3.0) speed = 3.0;
  }

  if (Raylib.isKeyPressed(KEYS.SPACE)) {
    drawLines = !drawLines;
  }

  const dt = Raylib.getFrameTime();

  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];
    star.z -= dt * speed;

    star.screenX = screenWidth * 0.5 + star.x / star.z;
    star.screenY = screenHeight * 0.5 + star.y / star.z;

    if (
      star.z < 0.05 ||
      star.screenX < 0 ||
      star.screenY < 0 ||
      star.screenX > screenWidth ||
      star.screenY > screenHeight
    ) {
      star.x = Raylib.getRandomValue(-Math.floor(screenWidth / 2), Math.floor(screenWidth / 2));
      star.y = Raylib.getRandomValue(-Math.floor(screenHeight / 2), Math.floor(screenHeight / 2));
      star.z = 1.0;
      star.screenX = screenWidth * 0.5 + star.x / star.z;
      star.screenY = screenHeight * 0.5 + star.y / star.z;
    }
  }

  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.BLACK);

  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];

    if (drawLines) {
      let t = star.z + 1.0 / 32.0;
      if (t > 1.0) t = 1.0;

      if (t - star.z > 0.001) {
        const startPos: Vector2 = {
          x: screenWidth * 0.5 + star.x / t,
          y: screenHeight * 0.5 + star.y / t,
        };
        const endPos: Vector2 = {
          x: star.screenX,
          y: star.screenY,
        };
        Raylib.drawLineV(startPos, endPos, COLORS.RAYWHITE);
      }
    } else {
      const radius = 1.0 + (1.0 - star.z) * 4.0;
      Raylib.drawCircle(Math.floor(star.screenX), Math.floor(star.screenY), radius, COLORS.RAYWHITE);
    }
  }

  Raylib.drawText(`Speed: ${Math.floor(speed * 10) / 10} ([MOUSE WHEEL] to adjust)`, 10, 40, 20, COLORS.RAYWHITE);
  Raylib.drawText(`Mode: ${drawLines ? "Lines" : "Points"} ([SPACE] to toggle)`, 10, 70, 20, COLORS.RAYWHITE);

  Raylib.drawFPS(10, 10);
  Raylib.endDrawing();
}

Raylib.closeWindow();
