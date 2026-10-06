import { Raylib, COLORS, KEYS, type Color, type Rectangle, type Vector2 } from "../src";

const SCREEN_WIDTH = 900;
const SCREEN_HEIGHT = 650;

Raylib.initWindow(SCREEN_WIDTH, SCREEN_HEIGHT, "Craylib Breakout");
Raylib.setTargetFPS(60);

// Game constants
const PADDLE_WIDTH = 110;
const PADDLE_HEIGHT = 16;
const BALL_RADIUS = 7;
const BRICK_ROWS = 5;
const BRICK_COLS = 10;
const BRICK_HEIGHT = 22;
const BRICK_GAP = 6;
const BRICK_OFFSET_Y = 80;
const BRICK_OFFSET_X = (SCREEN_WIDTH - (BRICK_COLS * 82 + (BRICK_COLS - 1) * BRICK_GAP)) / 2;

interface Brick {
  rec: Rectangle;
  color: Color;
  points: number;
  active: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: Color;
  alpha: number;
  life: number;
}

interface Trail {
  x: number;
  y: number;
}

const ROW_COLORS: Color[] = [
  COLORS.RED,
  COLORS.ORANGE,
  COLORS.GOLD,
  COLORS.LIME,
  COLORS.SKYBLUE,
];

const ROW_POINTS = [50, 40, 30, 20, 10];

let score = 0;
let highScore = 0;
let lives = 3;
let combo = 0;
let state: "READY" | "PLAY" | "GAMEOVER" | "VICTORY" = "READY";

let paddleX = (SCREEN_WIDTH - PADDLE_WIDTH) / 2;
const paddleY = SCREEN_HEIGHT - 45;

let ballPos: Vector2 = { x: SCREEN_WIDTH / 2, y: paddleY - BALL_RADIUS - 2 };
let ballSpeed: Vector2 = { x: 300, y: -300 };

const trail: Trail[] = [];
const particles: Particle[] = [];

let bricks: Brick[] = [];

function initBricks(): void {
  bricks = [];
  const brickWidth = 82;
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      const bx = BRICK_OFFSET_X + c * (brickWidth + BRICK_GAP);
      const by = BRICK_OFFSET_Y + r * (BRICK_HEIGHT + BRICK_GAP);
      bricks.push({
        rec: { x: bx, y: by, width: brickWidth, height: BRICK_HEIGHT },
        color: ROW_COLORS[r] ?? COLORS.WHITE,
        points: ROW_POINTS[r] ?? 10,
        active: true,
      });
    }
  }
}

function resetBall(): void {
  paddleX = (SCREEN_WIDTH - PADDLE_WIDTH) / 2;
  ballPos = { x: paddleX + PADDLE_WIDTH / 2, y: paddleY - BALL_RADIUS - 2 };
  ballSpeed = { x: (Math.random() > 0.5 ? 1 : -1) * 320, y: -320 };
  combo = 0;
  state = "READY";
}

function resetGame(): void {
  score = 0;
  lives = 3;
  combo = 0;
  initBricks();
  resetBall();
}

function spawnParticles(x: number, y: number, color: Color): void {
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 160;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 3 + Math.random() * 4,
      color,
      alpha: 1.0,
      life: 0.4 + Math.random() * 0.3,
    });
  }
}

resetGame();

while (!Raylib.windowShouldClose()) {
  const dt = Raylib.getFrameTime();

  // Paddle controls
  const mouseX = Raylib.getMouseX();
  if (mouseX > 0 && mouseX < SCREEN_WIDTH) {
    paddleX = mouseX - PADDLE_WIDTH / 2;
  }
  if (Raylib.isKeyDown(KEYS.LEFT) || Raylib.isKeyDown(KEYS.A)) paddleX -= 500 * dt;
  if (Raylib.isKeyDown(KEYS.RIGHT) || Raylib.isKeyDown(KEYS.D)) paddleX += 500 * dt;
  paddleX = Math.max(0, Math.min(SCREEN_WIDTH - PADDLE_WIDTH, paddleX));

  // State machine
  if (state === "READY") {
    ballPos.x = paddleX + PADDLE_WIDTH / 2;
    ballPos.y = paddleY - BALL_RADIUS - 2;
    if (Raylib.isKeyPressed(KEYS.SPACE) || Raylib.isMouseButtonPressed(0)) {
      state = "PLAY";
    }
  } else if (state === "PLAY") {
    // Ball movement
    ballPos.x += ballSpeed.x * dt;
    ballPos.y += ballSpeed.y * dt;

    // Trail
    trail.push({ x: ballPos.x, y: ballPos.y });
    if (trail.length > 8) trail.shift();

    // Wall bounces
    if (ballPos.x - BALL_RADIUS <= 0) {
      ballPos.x = BALL_RADIUS;
      ballSpeed.x = Math.abs(ballSpeed.x);
    } else if (ballPos.x + BALL_RADIUS >= SCREEN_WIDTH) {
      ballPos.x = SCREEN_WIDTH - BALL_RADIUS;
      ballSpeed.x = -Math.abs(ballSpeed.x);
    }

    if (ballPos.y - BALL_RADIUS <= 0) {
      ballPos.y = BALL_RADIUS;
      ballSpeed.y = Math.abs(ballSpeed.y);
    }

    // Paddle collision
    const paddleRec: Rectangle = { x: paddleX, y: paddleY, width: PADDLE_WIDTH, height: PADDLE_HEIGHT };
    if (Raylib.checkCollisionCircleRec(ballPos, BALL_RADIUS, paddleRec) && ballSpeed.y > 0) {
      const hitOffset = (ballPos.x - (paddleX + PADDLE_WIDTH / 2)) / (PADDLE_WIDTH / 2);
      const speedMag = Math.sqrt(ballSpeed.x * ballSpeed.x + ballSpeed.y * ballSpeed.y);
      const newAngle = (hitOffset * 60 - 90) * (Math.PI / 180);
      ballSpeed.x = Math.cos(newAngle) * speedMag;
      ballSpeed.y = Math.sin(newAngle) * speedMag;
      ballPos.y = paddleY - BALL_RADIUS - 1;
      combo = 0;
      spawnParticles(ballPos.x, paddleY, COLORS.LIGHTGRAY);
    }

    // Bricks collision
    let remainingBricks = 0;
    for (const b of bricks) {
      if (!b.active) continue;
      remainingBricks++;

      if (Raylib.checkCollisionCircleRec(ballPos, BALL_RADIUS, b.rec)) {
        b.active = false;
        combo++;
        const gained = b.points * (1 + Math.floor(combo / 3));
        score += gained;
        if (score > highScore) highScore = score;

        spawnParticles(ballPos.x, ballPos.y, b.color);

        // Simple bounce logic: horizontal or vertical
        const prevX = ballPos.x - ballSpeed.x * dt;
        if (prevX < b.rec.x || prevX > b.rec.x + b.rec.width) {
          ballSpeed.x = -ballSpeed.x;
        } else {
          ballSpeed.y = -ballSpeed.y;
        }

        // Slight speed increase per broken brick
        ballSpeed.x *= 1.01;
        ballSpeed.y *= 1.01;
        break;
      }
    }

    // Victory condition
    if (remainingBricks === 0) {
      state = "VICTORY";
    }

    // Ball lost
    if (ballPos.y - BALL_RADIUS > SCREEN_HEIGHT) {
      lives--;
      if (lives <= 0) {
        state = "GAMEOVER";
      } else {
        resetBall();
      }
    }
  } else if (state === "GAMEOVER" || state === "VICTORY") {
    if (Raylib.isKeyPressed(KEYS.SPACE)) {
      resetGame();
    }
  }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    p.alpha = Math.max(0, p.life * 2);
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }

  // Rendering
  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.BLACK);

  // Top Header HUD
  Raylib.drawText(`SCORE: ${score}`, 20, 20, 24, COLORS.GOLD);
  Raylib.drawText(`HIGH: ${highScore}`, 240, 20, 20, COLORS.GRAY);
  if (combo > 1) {
    Raylib.drawText(`COMBO x${combo}!`, 420, 20, 22, COLORS.YELLOW);
  }

  // Lives display (hearts / circles)
  for (let i = 0; i < 3; i++) {
    const lx = SCREEN_WIDTH - 120 + i * 30;
    const ly = 32;
    if (i < lives) {
      Raylib.drawCircle(lx, ly, 9, COLORS.RED);
    } else {
      Raylib.drawCircleLines(lx, ly, 9, COLORS.DARKGRAY);
    }
  }

  Raylib.drawLine(0, 60, SCREEN_WIDTH, 60, COLORS.DARKGRAY);

  // Draw Bricks
  for (const b of bricks) {
    if (!b.active) continue;
    Raylib.drawRectangleRec(b.rec, b.color);
    Raylib.drawRectangleLinesEx(b.rec, 1, COLORS.BLACK);
  }

  // Draw Particles
  for (const p of particles) {
    Raylib.drawRectangle(
      Math.floor(p.x),
      Math.floor(p.y),
      Math.floor(p.size),
      Math.floor(p.size),
      Raylib.fade(p.color, p.alpha),
    );
  }

  // Draw Ball Trail
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i]!;
    const f = (i + 1) / trail.length;
    Raylib.drawCircle(Math.floor(t.x), Math.floor(t.y), BALL_RADIUS * f, Raylib.fade(COLORS.GOLD, f * 0.35));
  }

  // Draw Ball
  Raylib.drawCircle(Math.floor(ballPos.x), Math.floor(ballPos.y), BALL_RADIUS, COLORS.WHITE);

  // Draw Paddle
  Raylib.drawRectangleRounded(
    { x: paddleX, y: paddleY, width: PADDLE_WIDTH, height: PADDLE_HEIGHT },
    0.4,
    4,
    COLORS.RAYWHITE,
  );

  // Overlay Messages
  if (state === "READY") {
    Raylib.drawText("PRESS SPACE TO LAUNCH", SCREEN_WIDTH / 2 - 165, SCREEN_HEIGHT / 2 + 50, 24, COLORS.RAYWHITE);
    Raylib.drawText("[A/D] or Mouse to control paddle", SCREEN_WIDTH / 2 - 145, SCREEN_HEIGHT / 2 + 85, 16, COLORS.GRAY);
  } else if (state === "GAMEOVER") {
    Raylib.drawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, Raylib.fade(COLORS.BLACK, 0.75));
    Raylib.drawText("GAME OVER", SCREEN_WIDTH / 2 - 130, SCREEN_HEIGHT / 2 - 40, 44, COLORS.RED);
    Raylib.drawText(`FINAL SCORE: ${score}`, SCREEN_WIDTH / 2 - 95, SCREEN_HEIGHT / 2 + 15, 22, COLORS.GOLD);
    Raylib.drawText("PRESS SPACE TO RESTART", SCREEN_WIDTH / 2 - 145, SCREEN_HEIGHT / 2 + 60, 20, COLORS.WHITE);
  } else if (state === "VICTORY") {
    Raylib.drawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, Raylib.fade(COLORS.BLACK, 0.75));
    Raylib.drawText("VICTORY!", SCREEN_WIDTH / 2 - 105, SCREEN_HEIGHT / 2 - 40, 44, COLORS.LIME);
    Raylib.drawText(`FINAL SCORE: ${score}`, SCREEN_WIDTH / 2 - 95, SCREEN_HEIGHT / 2 + 15, 22, COLORS.GOLD);
    Raylib.drawText("PRESS SPACE TO PLAY AGAIN", SCREEN_WIDTH / 2 - 160, SCREEN_HEIGHT / 2 + 60, 20, COLORS.WHITE);
  }

  Raylib.drawFPS(SCREEN_WIDTH - 90, SCREEN_HEIGHT - 25);
  Raylib.endDrawing();
}

Raylib.closeWindow();
