import { Raylib, COLORS, KEYS, type Vector2 } from "../src";

const screenWidth = 800;
const screenHeight = 450;

Raylib.initWindow(screenWidth, screenHeight, "raylib [shapes] - bouncing ball");
Raylib.setTargetFPS(60);

const ballPosition: Vector2 = {
  x: screenWidth / 2,
  y: screenHeight / 2,
};
const ballSpeed: Vector2 = {
  x: 5,
  y: 4,
};
const ballRadius = 20;
const gravity = 0.2;

let useGravity = true;
let pause = false;
let framesCounter = 0;

while (!Raylib.windowShouldClose()) {
  if (Raylib.isKeyPressed(KEYS.G)) useGravity = !useGravity;
  if (Raylib.isKeyPressed(KEYS.SPACE)) pause = !pause;

  if (!pause) {
    ballPosition.x += ballSpeed.x;
    ballPosition.y += ballSpeed.y;

    if (useGravity) ballSpeed.y += gravity;

    if (ballPosition.x >= screenWidth - ballRadius || ballPosition.x <= ballRadius) {
      ballSpeed.x *= -1;
    }
    if (ballPosition.y >= screenHeight - ballRadius || ballPosition.y <= ballRadius) {
      ballSpeed.y *= -0.95;
      if (ballPosition.y >= screenHeight - ballRadius) {
        ballPosition.y = screenHeight - ballRadius;
      }
    }
  } else {
    framesCounter++;
  }

  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.RAYWHITE);

  Raylib.drawCircleV(ballPosition, ballRadius, COLORS.MAROON);
  Raylib.drawText("PRESS SPACE to PAUSE BALL MOVEMENT", 10, screenHeight - 25, 20, COLORS.LIGHTGRAY);

  if (useGravity) {
    Raylib.drawText("GRAVITY: ON (Press G to disable)", 10, screenHeight - 50, 20, COLORS.DARKGREEN);
  } else {
    Raylib.drawText("GRAVITY: OFF (Press G to enable)", 10, screenHeight - 50, 20, COLORS.RED);
  }

  if (pause && Math.floor(framesCounter / 30) % 2 === 0) {
    Raylib.drawText("PAUSED", 350, 200, 30, COLORS.GRAY);
  }

  Raylib.drawFPS(10, 10);
  Raylib.endDrawing();
}

Raylib.closeWindow();
