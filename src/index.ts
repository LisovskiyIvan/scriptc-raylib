export * from "../gen/raylib";
export * from "./colors";
export * from "./constants";
export * from "./types";
export * from "./config";

import { Raylib as _Raylib } from "../gen/raylib";
import { config } from "./config";

export const Raylib = {
  ..._Raylib,
  config,
};

export const raylib = Raylib;
