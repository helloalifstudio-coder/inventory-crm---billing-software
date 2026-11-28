# Installs local Rust + MSVC Build Tools + Tauri CLI on Windows 11/10 if you want to build .exe/.msi locally.
# GitHub Actions (windows-latest) already builds installers automatically without needing local Rust tools.
$ErrorActionPreference = "Stop"

Write-Host "Checking winget availability..." -ForegroundColor Cyan
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Error "winget not found. Please update App Installer from Microsoft Store."
}

if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Rustup (MSVC target)..." -ForegroundColor Yellow
    winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
}

Write-Host "Checking Visual Studio C++ Build Tools..." -ForegroundColor Yellow
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" --accept-source-agreements --accept-package-agreements

Write-Host "Installing Tauri CLI (cargo-tauri)..." -ForegroundColor Yellow
cargo install tauri-cli --version "^2.0.0"

Write-Host "Done! Restart your terminal and run: cd apps/windows-native/src-tauri && cargo tauri build" -ForegroundColor Green
