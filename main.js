const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const isProd = app.isPackaged;

let mainWindow = null;
let pyProcess = null;

function getConfigPath() {
    return path.join(app.getPath('userData'), 'config.json');
}

function getUserProfilePath() {
    return path.join(app.getPath('userData'), 'user.json');
}

function readConfig() {
    try {
        if (fs.existsSync(getConfigPath())) {
            return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
        }
    } catch (e) {}
    return {};
}

function readUserProfile() {
    try {
        if (fs.existsSync(getUserProfilePath())) {
            return JSON.parse(fs.readFileSync(getUserProfilePath(), 'utf8'));
        }
    } catch (e) {}
    return {};
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');

    // ---------------- WINDOW CONTROLS ----------------
    ipcMain.on('minimize-window', () => mainWindow.minimize());
    ipcMain.on('maximize-window', () => {
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    });
    ipcMain.on('close-window', () => mainWindow.close());
    ipcMain.on('enter-fullscreen', () => { if (mainWindow) mainWindow.setFullScreen(true); });
    ipcMain.on('exit-fullscreen',  () => { if (mainWindow) mainWindow.setFullScreen(false); });

    // ---------------- API KEY MANAGEMENT ----------------
    // Renderer asks: is an API key already saved?
    ipcMain.handle('check-api-key', () => {
        const config = readConfig();
        return !!(config.groq_api_key && config.groq_api_key.trim());
    });

    ipcMain.handle('get-user-profile', () => {
        return readUserProfile();
    });

    ipcMain.handle('save-user-profile', (_, name) => {
        const dir = app.getPath('userData');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const profile = { name: String(name || '').trim() };
        fs.writeFileSync(getUserProfilePath(), JSON.stringify(profile, null, 2));
        return profile;
    });

    ipcMain.handle('clear-user-profile', () => {
        const profilePath = getUserProfilePath();
        if (fs.existsSync(profilePath)) {
            fs.unlinkSync(profilePath);
        }
        return true;
    });

    // Renderer saves a new API key
    ipcMain.on('save-api-key', (_, key) => {
        const dir = app.getPath('userData');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const config = readConfig();
        config.groq_api_key = key.trim();
        fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
        // Start the Python engine now that we have a key
        startPythonEngine();
    });

    // ---------------- START PYTHON AI ENGINE ----------------
    // Only auto-start if API key already exists
    const config = readConfig();
    if (config.groq_api_key && config.groq_api_key.trim()) {
        startPythonEngine();
    }
    // Otherwise renderer will show setup screen, then call save-api-key which triggers startPythonEngine
}

/* ================= PYTHON ENGINE ================= */
function sendEngineError(msg) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-message', JSON.stringify({ type: 'ERROR', msg }));
    }
}

function startPythonEngine() {
    if (pyProcess) return; // already running

    const configDir = app.getPath('userData');
    const env = { ...process.env, AI_CONFIG_DIR: configDir };

    let engineCmd, engineArgs;
    if (isProd) {
        engineCmd = path.join(process.resourcesPath, 'engine', 'engine.exe');
        engineArgs = [];
        // Verify executable exists before attempting spawn
        if (!fs.existsSync(engineCmd)) {
            sendEngineError(`Engine not found at: ${engineCmd} — please reinstall the app.`);
            return;
        }
    } else {
        engineCmd = 'python';
        engineArgs = [path.join(__dirname, 'engine', 'app.py')];
    }

    pyProcess = spawn(engineCmd, engineArgs, { env });
    console.log('[AI] Spawning engine:', engineCmd);

    // ── stdout: parse newline-delimited JSON from engine ─────────────────────
    let stdoutBuffer = '';
    pyProcess.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop();
        for (const line of lines) {
            const msg = line.trim();
            if (!msg) continue;
            console.log('[AI]', msg);
            if (mainWindow && !mainWindow.isDestroyed())
                mainWindow.webContents.send('ai-message', msg);
        }
    });

    // ── stderr: write to log file only — do NOT spam toasts ─────────────────
    // Python's crash hook (in app.py) writes a clean engine-crash.log;
    // raw stderr contains PyInstaller boot noise that confuses the user.
    const stderrLogPath = path.join(configDir, 'engine-stderr.log');
    try { fs.writeFileSync(stderrLogPath, ''); } catch(e) {}
    let stderrFull = '';
    pyProcess.stderr.on('data', (data) => {
        const txt = data.toString();
        stderrFull += txt;
        console.error('[AI STDERR]', txt.trimEnd());
        try { fs.appendFileSync(stderrLogPath, txt); } catch(e) {}
    });

    // ── process-level spawn error (e.g. ENOENT) ───────────────────────────────
    pyProcess.on('error', (err) => {
        console.error('[AI] Spawn error:', err);
        sendEngineError(`Engine failed to start: ${err.message}`);
        pyProcess = null;
    });

    // ── unexpected early exit ─────────────────────────────────────────────────
    pyProcess.on('close', (code) => {
        console.log('[AI] Engine process exited with code', code);
        if (code !== 0 && code !== null) {
            // 1. Try the clean crash log written by Python's sys.excepthook
            const crashLogPath = path.join(configDir, 'engine-crash.log');
            let detail = '';
            try {
                if (fs.existsSync(crashLogPath)) {
                    const lines = fs.readFileSync(crashLogPath, 'utf8')
                        .split('\n').map(l => l.trim()).filter(Boolean);
                    detail = lines.slice(-2).join(' → ');
                }
            } catch(e) {}
            // 2. Fall back to last meaningful stderr line
            if (!detail) {
                const errLines = stderrFull.split('\n').map(l => l.trim())
                    .filter(l => l && !l.startsWith('[') && !l.startsWith('WARNING')
                                  && !l.startsWith('DEPRECATION') && !/^\d+$/.test(l));
                detail = errLines.slice(-2).join(' → ');
            }
            sendEngineError(detail
                ? `Engine crashed: ${detail}`
                : `Engine failed (exit ${code}). See engine-crash.log in AppData.`);
        }
        pyProcess = null;
    });
}

// Send messages FROM renderer TO Python
ipcMain.on('ai-send', (_, msg) => {
    if (pyProcess) {
        pyProcess.stdin.write(msg + '\n');
    } else {
        // Engine isn't running — tell the renderer so the user sees the toast
        sendEngineError('AI engine is not running. Please restart the app.');
    }
});

/* ================= APP LIFECYCLE ================= */
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (pyProcess) pyProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});

