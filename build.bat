@echo off
setlocal EnableDelayedExpansion

echo.
echo ============================================================
echo   AI Mock Interview Assistant — Build Script v2.0
echo ============================================================
echo.

:: ── 1. Check prerequisites ──────────────────────────────────
where python >nul 2>&1 || (echo [ERROR] Python not found in PATH. & exit /b 1)
where npm    >nul 2>&1 || (echo [ERROR] npm not found in PATH.    & exit /b 1)

:: ── 2. Install Node dependencies ────────────────────────────
echo [1/4] Installing Node.js dependencies...
call npm install
if %errorlevel% neq 0 (echo [ERROR] npm install failed. & exit /b 1)
echo       Done.
echo.

:: ── 3. Set up Python venv + install deps ────────────────────
echo [2/4] Setting up Python virtual environment...
python -m venv .venv
call .venv\Scripts\activate.bat

echo       Installing build tools...
pip install --upgrade pip pyinstaller >nul 2>&1

echo       Installing app dependencies...
pip install -r requirements.txt
if %errorlevel% neq 0 (echo [ERROR] pip install failed. & exit /b 1)
echo       Done.
echo.

:: ── 4. Bundle Python engine with PyInstaller ─────────────────
echo [3/4] Bundling Python engine (this may take a few minutes)...
echo       Uses engine/engine.spec — includes PortAudio DLL + SSL cert bundle
echo       so that STT (Groq Whisper) and LLM (Groq API) work in the build.
echo.

cd engine
pyinstaller engine.spec --clean --noconfirm
if %errorlevel% neq 0 (
    echo [ERROR] PyInstaller failed. Check output above for details.
    cd ..
    exit /b 1
)
cd ..
echo.
echo       Done — engine\dist\engine\engine.exe created.
echo.

:: ── 5. Build Electron installer ──────────────────────────────
echo [4/4] Building Windows installer with electron-builder...

:: Kill running processes that may lock files
taskkill /F /IM "AI Mock Interview Assistant.exe" >nul 2>&1
taskkill /F /IM "engine.exe" >nul 2>&1

:: Clean previous output
if exist dist-installer (
    rmdir /S /Q dist-installer >nul 2>&1
)
if exist dist-installer (
    echo [ERROR] Could not remove dist-installer. Close any open app windows and retry.
    exit /b 1
)

call npm run build
if %errorlevel% neq 0 (echo [ERROR] electron-builder failed. & exit /b 1)
echo.

echo ============================================================
echo   BUILD COMPLETE
echo   Installer: dist-installer\AI-Mock-Interview-Assistant-Setup-v1.0.0.exe
echo ============================================================
echo.
pause
