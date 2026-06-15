@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SFD Sketch - Web Surumu

echo ===============================================
echo          SFD SKETCH TEMIZ WEB SURUMU
echo ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo HATA: Node.js kurulu degil.
  echo Once Node.js kurup tekrar calistir.
  pause
  exit /b 1
)

if not exist "node_modules\express\package.json" (
  echo Gerekli paketler ilk kez kuruluyor...
  call npm.cmd config set registry https://registry.npmjs.org/
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo HATA: Paket kurulumu basarisiz oldu.
    pause
    exit /b 1
  )
)

echo.
echo Sunucu aciliyor: http://localhost:3000
echo Internet adresi: https://www.sfdsketch.com
echo Bu pencereyi kapatma.
echo.
call npm.cmd start

echo.
echo Sunucu kapandi veya hata verdi.
pause
