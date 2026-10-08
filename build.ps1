# PowerShell build script for Windows
# Usage: .\build.ps1
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# 1. Header discovery
$HeaderCandidates = @(
    $env:RAYLIB_H,
    "$env:RAYLIB_PATH\include\raylib.h",
    "$env:RAYLIB_PATH\src\raylib.h",
    "C:\raylib\raylib\src\raylib.h",
    "C:\raylib\w64devkit\x86_64-w64-mingw32\include\raylib.h",
    "C:\msys64\mingw64\include\raylib.h",
    "C:\msys64\ucrt64\include\raylib.h",
    "$ScriptDir\assets\include\raylib.h"
)

$RAYLIB_H = ""
foreach ($cand in $HeaderCandidates) {
    if ($cand -and (Test-Path $cand)) {
        $RAYLIB_H = $cand
        break
    }
}

if (-not $RAYLIB_H) {
    Write-Error "raylib.h not found! Please install raylib or set the RAYLIB_H environment variable."
}

Write-Host "== header: $RAYLIB_H"

# 2. Generate bindings
bun tools/gen_bindings.ts "$RAYLIB_H" gen

# 3. Compile C shim
Write-Host "== shim"
$HeaderDir = Split-Path -Parent $RAYLIB_H
cc -O2 -c gen/raylib_shim.c -o gen/raylib_shim.o -I"$HeaderDir"
ar rcs gen/libraylib_shim.a gen/raylib_shim.o

# 4. Resolve the raylib library directory. The manifest links raylib as a
# system library, so this is the only place the path is supplied.
Write-Host "== scriptc"
$LibraryDirs = @(
  $env:LIBRARY_PATH,
  "$env:RAYLIB_PATH\lib",
  "$env:RAYLIB_PATH\bin",
  "C:\raylib\raylib\src",
  "C:\msys64\mingw64\lib",
  "C:\msys64\ucrt64\lib",
  "C:\vcpkg\installed\x64-windows\lib"
)
$LibDir = $null
foreach ($dir in $LibraryDirs) {
  if (-not $dir) { continue }
  $hit = @("libraylib.a", "raylib.lib", "raylib.dll", "libraylib.dll") |
    ForEach-Object { Join-Path $dir $_ } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
  if ($hit) { $LibDir = $dir; break }
}

if (-not $LibDir) {
  Write-Error "raylib library not found! Please install raylib or set LIBRARY_PATH."
}

Write-Host "== library path: $LibDir"
$env:LIBRARY_PATH = $LibDir
scriptc build demo/main.ts --ffi gen/raylib_ffi.json -o demo/demo.exe

Write-Host "== done: demo/demo.exe"
