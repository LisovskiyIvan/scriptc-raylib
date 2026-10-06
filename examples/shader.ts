import { Raylib, COLORS, KEYS } from "../src";
import { join } from "path";
import { existsSync } from "fs";

Raylib.initWindow(1200, 800, "Shader Demo");
Raylib.setTargetFPS(60);

const fontDir = existsSync("assets/fonts") ? "assets/fonts" : "../assets/fonts";
const font = Raylib.loadFontEx(join(fontDir, "test.ttf"), 32);

const fsCode = `#version 330
in vec2 fragTexCoord;
in vec4 fragColor;
out vec4 finalColor;
uniform float seconds;
void main() {
    float r = 0.5 + 0.5 * sin(seconds * 2.0 + fragTexCoord.x * 6.28);
    float g = 0.5 + 0.5 * sin(seconds * 2.0 + fragTexCoord.y * 6.28 + 2.0);
    float b = 0.5 + 0.5 * sin(seconds * 2.0 + (fragTexCoord.x + fragTexCoord.y) * 3.14 + 4.0);
    finalColor = vec4(r, g, b, 1.0);
}
`;
const shader = Raylib.loadShaderFromMemory(null, fsCode);
const secondsLoc = Raylib.getShaderLocation(shader, "seconds");

let time = 0;

while (!Raylib.windowShouldClose()) {
  const dt = Raylib.getFrameTime();
  time += dt;

  const timeBuf = new Float32Array([time]);
  Raylib.setShaderValue(shader, secondsLoc, new Uint8Array(timeBuf.buffer), 0);

  Raylib.beginDrawing();
  Raylib.clearBackground(COLORS.DARKGRAY);

  Raylib.beginShaderMode(shader);
  Raylib.drawRectangle(0, 0, 1200, 400, COLORS.WHITE);
  Raylib.endShaderMode();

  Raylib.drawTextEx(font, "Shader Demo", { x: 20, y: 420 }, 48, 2, COLORS.GOLD);
  
  const info = Raylib.getGlyphInfo(font, 65);
  Raylib.drawText(`'A' glyph:`, 20, 490, 20, COLORS.WHITE);
  Raylib.drawText(`offsetX: ${info.offsetX}, offsetY: ${info.offsetY}, advanceX: ${info.advanceX}`, 20, 515, 16, COLORS.CYAN);
  Raylib.drawText(`image: ${info.image}`, 20, 535, 16, COLORS.LIME);

  const cp = Raylib.getCodepoint("Hello");
  Raylib.drawText(`Codepoint 'H': ${cp.codepoint} (size: ${cp.size})`, 20, 570, 16, COLORS.ORANGE);

  Raylib.drawText(`Text length: ${Raylib.textLength("Hello World")}`, 20, 600, 16, COLORS.MAGENTA);
  Raylib.drawText(`Text find 'World': index ${Raylib.textFindIndex("Hello World", "World")}`, 20, 625, 16, COLORS.BEIGE);

  Raylib.drawFPS(Raylib.getScreenWidth() - 100, 10);
  Raylib.endDrawing();
}

Raylib.unloadShader(shader);

Raylib.unloadFont(font);
Raylib.closeWindow();