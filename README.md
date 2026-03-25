<div align="center">

<h1>🤖 AI Mock Interview Assistant</h1>

<p>
  <strong>An offline-first, AI-powered mock interview desktop application built with Electron + Python.</strong><br/>
  Generates real interview questions using a local LLM, transcribes your spoken answers in real-time using Groq Whisper, and produces a detailed PDF performance report — all on your own machine.
</p>

<p>
  <a href="https://github.com/dvoid7/aimock-interview/releases"><img src="https://img.shields.io/github/v/release/dvoid7/aimock-interview?style=flat-square&label=Release&color=00ff88" alt="Release"/></a>
  <img src="https://img.shields.io/badge/Platform-Windows-blue?style=flat-square&logo=windows" alt="Platform"/>
  <img src="https://img.shields.io/badge/Electron-33.x-47848f?style=flat-square&logo=electron" alt="Electron"/>
  <img src="https://img.shields.io/badge/Python-3.10%2B-3776ab?style=flat-square&logo=python" alt="Python"/>
  <img src="https://img.shields.io/badge/LLM-Llama%203.2%203B-ff6600?style=flat-square" alt="LLM"/>
  <img src="https://img.shields.io/badge/STT-Groq%20Whisper-f55036?style=flat-square" alt="Groq"/>
  <img src="https://img.shields.io/badge/License-Open%20Source-brightgreen?style=flat-square" alt="License"/>
</p>

<br/>

<!-- SCREENSHOTS -->
> 📸 **Add your screenshots to `docs/screenshots/` and update the paths below.**

| Splash / Loading | First-Time Setup | Login |
|:---:|:---:|:---:|
| ![Splash](docs/screenshots/splash.png) | ![Setup](docs/screenshots/setup.png) | ![Login](docs/screenshots/login.png) |

| Dashboard | Live Interview Session | PDF Report |
|:---:|:---:|:---:|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Session](docs/screenshots/session.png) | ![Report](docs/screenshots/report.png) |

</div>

---

## 📖 Table of Contents

- [About the Project](#-about-the-project)
- [Research Paper](#-research-paper)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [How It Works](#-how-it-works)
- [Prerequisites](#-prerequisites)
- [Getting Started (Dev Mode)](#-getting-started-dev-mode)
- [Building for Production](#-building-for-production)
- [Environment Variables](#-environment-variables)
- [Supported Interview Topics](#-supported-interview-topics)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [License](#-license)
- [Author](#-author)

---

## 🧠 About the Project

**AI Mock Interview Assistant** is a desktop application that simulates a real technical interview experience entirely on your own device. It combines a **locally-running Large Language Model (LLM)** for intelligent question generation with **Groq's free cloud Whisper API** for fast, accurate speech-to-text transcription.

No subscription. No data sent to training servers. Your answers stay on your machine.

The app:
- **Listens** to your spoken answers in real time via your microphone
- **Transcribes** your speech using Groq Whisper (whisper-large-v3-turbo)
- **Generates** contextual follow-up questions using a local Llama 3.2 3B model
- **Evaluates** your entire session and exports a **PDF performance report** with per-question scores and improvement tips

---

## 📄 Research Paper

> This project was developed as part of a research study on **AI-assisted interview preparation and automated competency evaluation using local language models**.

### Citation

If you use this project in academic work, please cite:

```bibtex
@software{sharanagate2026aimock,
  author    = {Ved Sharanagate},
  title     = {AI Mock Interview Assistant: Offline-First Interview Preparation Using Local LLMs and Real-Time Speech Recognition},
  year      = {2026},
  publisher = {GitHub},
  url       = {https://github.com/dvoid7/aimock-interview}
}
```

### Research Focus Areas

| Area | Description |
|------|-------------|
| **Local LLM inference** | On-device question generation without cloud dependency using quantized Llama 3.2 |
| **Hybrid AI pipeline** | Combining offline LLM + cloud STT (Groq Whisper) for a practical latency/accuracy balance |
| **Automated evaluation** | LLM-driven scoring and feedback generation for open-ended spoken answers |
| **Interview simulation fidelity** | Evaluating whether AI-generated questions match real interview difficulty and progression |
| **Accessibility** | Enabling quality interview practice for users without access to live mock interviewers |

---

## ✨ Features

- 🎙️ **Real-time speech recognition** — Powered by Groq Whisper (`whisper-large-v3-turbo`), transcribes your spoken answers as you talk
- 🧠 **Local LLM questioning** — Llama 3.2 3B Instruct (Q4_K_M quantized, runs entirely on CPU, no GPU needed)
- 📊 **PDF Performance Report** — Auto-generated after each session with per-question scores (1–10), targeted feedback, and improvement tips
- 🎯 **18 Interview Topics** — Technical and HR topics selectable from the dashboard
- 📈 **3 Difficulty Levels** — Easy, Intermediate, Advanced
- 📷 **Camera + Mic Live Preview** — Real-time video/audio monitoring to simulate interview conditions
- 🔇 **Intelligent Silence Detection** — Automatically flushes buffered audio and queues follow-up questions after a configurable pause
- 🔐 **Privacy-first** — API key stored locally in `%AppData%`, never bundled in the installer
- 🏠 **Offline LLM** — Questions generated locally; only STT calls leave your machine
- 🪟 **Custom Frameless UI** — Sleek dark-themed window with custom min/max/close controls
- 👤 **User Profiles** — Persistent login with name saved locally
- ⏱️ **Session Timer** — Track how long your session has been running
- 📁 **Report History** — All PDF reports saved in `engine/reports/`

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron Frontend (Node.js)                 │
│  index.html  ←→  renderer.js  ←→  main.js (IPC bridge)          │
└────────────────────────┬────────────────────────────────────────┘
                         │  stdin/stdout JSON protocol
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Python AI Engine (app.py)                     │
│                                                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│  │  sounddevice │  │   llama-cpp-     │  │  Groq Whisper    │    │
│  │  (mic input) │→ │   python (LLM)   │  │  API (STT)       │    │
│  └──────────────┘  │  LOCAL / OFFLINE │  │  cloud.groq.com  │    │
│                    └─────────┬────────┘  └────────┬─────────┘    │
│                              │ questions           │ transcripts │
│                              ▼                     ▼             │
│                     ┌─────────────────────────────────────┐      │
│                     │         reportlab (PDF output)      │      │
│                     └─────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

### Communication Protocol

The Electron main process spawns the Python engine as a child process. All communication is via **newline-delimited JSON** over `stdin`/`stdout`:

| Direction | Message Type | Description |
|-----------|-------------|-------------|
| JS → Python | `START_LISTENING` | Begins session with topics, difficulty, user name |
| JS → Python | `STOP_LISTENING` | Ends session and triggers report generation |
| JS → Python | `GET_TOPICS` | Requests available topic list |
| Python → JS | `QUESTION` | A new interview question to display |
| Python → JS | `TRANSCRIPT_FINAL` | Transcribed answer text |
| Python → JS | `REPORT_READY` | PDF report path when generation complete |
| Python → JS | `ENGINE_STATUS` | `LOADING` or `READY` |
| Python → JS | `ERROR` | Error messages / warnings |

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Role |
|-----------|---------|------|
| [Electron](https://electronjs.org) | 33.x | Desktop app shell |
| HTML5 / CSS3 / JS | — | UI, camera/mic access |
| Font Awesome | 6.4 | Icons |

### Backend (Python Engine)
| Library | Role |
|--------|------|
| [llama-cpp-python](https://github.com/abetlen/llama-cpp-python) | Local LLM inference (Llama 3.2 3B) |
| [groq](https://pypi.org/project/groq/) | Groq Whisper API client for speech-to-text |
| [sounddevice](https://python-sounddevice.readthedocs.io) | Microphone audio capture |
| [numpy](https://numpy.org) | Audio buffer processing & RMS silence detection |
| [reportlab](https://www.reportlab.com) | PDF report generation |
| [python-dotenv](https://pypi.org/project/python-dotenv/) | `.env` loading in development |

### Build Tools
| Tool | Role |
|------|------|
| [electron-builder](https://www.electron.build) | Windows NSIS installer packaging |
| [PyInstaller](https://pyinstaller.org) | Bundles Python engine to `engine.exe` |
| `build.bat` | One-command full project build script |

---

## ⚙️ How It Works

```
1. App launches → checks for saved Groq API key
       │
       ├─ Not found → shows First-Time Setup screen → user enters gsk_... key
       │                   (saved to %AppData%\AI Mock Interview Assistant\config.json)
       │
       └─ Found → Python engine starts → loads Llama 3.2 3B model (~2GB RAM)

2. User logs in (name stored locally) → Dashboard appears

3. User selects topics + difficulty → clicks "Start Interview"

4. Python engine receives START_LISTENING:
   ├─ Llama generates first question → displayed in UI
   ├─ Microphone starts recording in 5-second chunks
   ├─ Each chunk → Groq Whisper API → transcript text
   ├─ Transcript displayed live in UI
   ├─ After 3 seconds silence → answer flushed to LLM
   └─ Llama generates follow-up question → loop continues

5. User clicks "End Session"
   ├─ Python engine receives STOP_LISTENING
   ├─ All Q&A pairs sent to Llama for evaluation
   ├─ Scores (1–10), feedback, improvement tips generated
   └─ PDF report exported → engine/reports/interview_report_YYYYMMDD_HHMMSS.pdf
```

---

## 📋 Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Windows 10/11** (x64) | App targets Windows only |
| **Node.js ≥ 18** | [nodejs.org](https://nodejs.org) — for Electron and npm |
| **Python 3.10–3.12** | [python.org](https://python.org) — for the AI engine |
| **pip** | Comes with Python |
| **Groq API Key (free)** | Get one at [console.groq.com](https://console.groq.com) — needed for speech transcription only |
| **LLM model file** | `Llama-3.2-3B-Instruct-Q4_K_M.gguf` placed at `engine/models/llm/` (see below) |
| **Microphone** | Required for voice input |

### Downloading the LLM Model

The model file is **not included** in this repository (it is ~2 GB).

Download it from Hugging Face:

```
Model:  Llama-3.2-3B-Instruct-Q4_K_M.gguf
Source: https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF
```

Place the downloaded file at:
```
engine/
└── models/
    └── llm/
        └── Llama-3.2-3B-Instruct-Q4_K_M.gguf   ← here
```

---

## 🚀 Getting Started (Dev Mode)

### 1. Clone the repository

```bash
git clone https://github.com/dvoid7/aimock-interview.git
cd aimock-interview
```

### 2. Install Node dependencies

```bash
npm install
```

### 3. Set up Python environment

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Configure environment variables

Copy the example env file and add your Groq API key:

```bash
copy .env.example .env
```

Edit `.env`:
```
GROQ_API_KEY=gsk_your_actual_key_here
```

> ℹ️ In development mode the app reads `GROQ_API_KEY` from `.env`.  
> In production the key is saved via the in-app setup screen to `%AppData%`.

### 5. Download the LLM model

Place `Llama-3.2-3B-Instruct-Q4_K_M.gguf` in `engine/models/llm/` (see [Prerequisites](#-prerequisites)).

### 6. Run the app

```bash
npm start
```

---

## 📦 Building for Production

The project ships a single `build.bat` script that handles everything:

```bat
build.bat
```

What it does, step by step:

| Step | Action |
|------|--------|
| **1** | Checks Python + npm are available |
| **2** | Runs `npm install` |
| **3** | Creates `.venv`, installs `pyinstaller` + `requirements.txt` |
| **4** | Runs PyInstaller → produces `engine/dist/engine/engine.exe` |
| **5** | Runs `electron-builder` → produces NSIS installer in `dist-installer/` |

After a successful build:
```
dist-installer/
└── AI-Mock-Interview-Assistant-Setup-v1.0.0.exe   ← distributable installer
```

The installer:
- Is a standard Windows NSIS installer (one-click or configurable)
- Creates Start Menu + Desktop shortcuts
- **Does NOT bundle the LLM model** (too large; user must provide it)
- **Does NOT bundle any API keys**

> ⚠️ **Note:** You must place the LLM model at `engine/models/llm/` before building so it gets bundled correctly by `electron-builder`'s `extraResources`.

---

## 🔑 Environment Variables

Create a `.env` file in the project root for **development mode only**:

```env
# Copy this file to .env and fill in your values
# See .env.example for a template

GROQ_API_KEY=gsk_...
```

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ Yes | Your Groq API key for Whisper speech-to-text. Free at [console.groq.com](https://console.groq.com). Must start with `gsk_`. |

> **Production:** The `.env` file is **not used** in built/packaged apps. The key is saved by the user through the in-app first-time setup screen and stored in `%AppData%\AI Mock Interview Assistant\config.json`.

> **Security:** `.env` is listed in `.gitignore` and excluded from the installer build — it is never shipped.

---

## 🎯 Supported Interview Topics

Choose any combination of topics when starting a session:

| Technical | Frameworks | Soft Skills |
|-----------|-----------|-------------|
| Python | React | HR Questions |
| Java | Node.js | Behavioral |
| JavaScript | Angular | Leadership |
| C++ | DevOps | Teamwork |
| C# | Machine Learning | |
| Data Structures | | |
| Algorithms | | |
| System Design | | |
| SQL | | |

**Difficulty Levels:** Easy · Intermediate · Advanced

---

## 📁 Project Structure

```
aimock-interview/
│
├── main.js                  # Electron main process — window, IPC, Python spawning
├── renderer.js              # Electron renderer — UI logic, camera/mic, session flow
├── index.html               # App HTML — all views (setup, login, dashboard, session)
├── package.json             # Node.js config + electron-builder config
├── requirements.txt         # Python dependencies
├── build.bat                # Full build script (Python bundle + Electron installer)
├── .env.example             # Template for environment variables
├── LICENSE.txt              # License
│
├── assets/
│   ├── style.css            # All UI styles (dark theme, animations, layouts)
│   └── icon.ico             # App icon
│
└── engine/
    ├── app.py               # Python AI engine — LLM, Whisper, audio, report gen
    ├── engine.spec          # PyInstaller build spec
    │
    ├── models/
    │   └── llm/
    │       └── Llama-3.2-3B-Instruct-Q4_K_M.gguf   # ← NOT in repo, download separately
    │
    ├── reports/             # Auto-generated PDF reports saved here
    └── user_data/           # Local user profile storage
```

---

## 🤝 Contributing

Contributions, bug reports, and feature suggestions are welcome!

1. Fork this repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to your fork: `git push origin feature/your-feature-name`
5. Open a Pull Request

### Areas to contribute

- 🌐 **Linux / macOS support** — currently Windows only; cross-platform port needed
- 🔊 **TTS / Audio feedback** — read questions aloud using a TTS engine
- 🧑‍💻 **More topics** — add domain-specific question banks
- 📊 **Analytics dashboard** — track scores across multiple sessions over time
- 🎨 **Themes** — light mode or custom color schemes
- 🧪 **Tests** — unit tests for the Python engine

Please follow the existing code style and open an issue first for large changes.

---

## 📜 License

See [LICENSE.txt](LICENSE.txt) for details.

---

## 👤 Author

**Ved Sharanagate**

- GitHub: [@VortexV7](https://github.com/VortexV7)
- Email: vedsharangate@gmail.com

---

<div align="center">
  <sub>Built with ❤️ for AI research and interview preparation.</sub>
</div>
