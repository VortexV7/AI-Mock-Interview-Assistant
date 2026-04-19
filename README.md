# AI Mock Interview Assistant

AI Mock Interview Assistant is a Windows desktop application for realistic, AI-powered interview practice. It combines topic-based interview setup, live speech transcription, adaptive follow-up questions, coding-answer support, focus monitoring, and automated PDF performance reports in a single local-first desktop experience.

This repository contains the source code for the application. It is a **private proprietary project** and is **not open source**.

## Notice

This project is provided for portfolio, demonstration, personal, and educational reference purposes only under the terms in [LICENSE.txt](LICENSE.txt).

- Redistribution is not permitted without explicit written permission
- Commercial use is not permitted without explicit written permission
- Modification and derivative distribution are not permitted without explicit written permission
- A separate commercial or collaboration arrangement requires direct approval from the author

## Table of Contents

- [Product Overview](#product-overview)
- [Core Capabilities](#core-capabilities)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Application Flow](#application-flow)
- [First-Time Setup](#first-time-setup)
- [Local Development](#local-development)
- [Build and Packaging](#build-and-packaging)
- [PDF Reports](#pdf-reports)
- [Configuration and Data Storage](#configuration-and-data-storage)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Author](#author)
- [License](#license)

## Product Overview

AI Mock Interview Assistant is designed to simulate a guided interview session inside a desktop application. The user selects topics, sets a difficulty level, starts an interview session, answers questions verbally or through the built-in code editor, and receives a PDF report with structured feedback at the end of the session.

The project follows a local-first approach for desktop UX and user data storage:

- the UI runs inside Electron
- the AI engine runs in Python
- user settings are stored locally on the machine
- reports are generated locally and saved to the application data directory
- AI requests are made through the user's own Groq API key

## Core Capabilities

### Interview Experience

- Topic-based interview configuration from the dashboard
- Multiple interview domains including programming, CS fundamentals, frameworks, SQL, behavioral, and leadership topics
- Difficulty control before session start
- One-question-at-a-time interview flow
- Adaptive follow-up questions based on recent conversation context
- Built-in code-answer workflow for coding-style prompts

### Audio and AI

- Speech-to-text transcription using Groq Whisper
- LLM-powered question generation and answer evaluation
- Text-to-speech playback for interviewer questions
- Microphone activity visualization during the session

### Session Controls

- Fullscreen interview mode
- Start, pause, resume, and end session controls
- Live timer during the interview
- Camera preview in dashboard and session views
- Camera and microphone device selection from Settings

### Monitoring and Behavioural Signals

- Focus warnings when the window loses focus
- Camera-based face-presence checks during the session
- Behavioural flag summary included in the report
- Filler-word tracking across user answers

### Reporting

- Automatic PDF report generation when the session ends
- Per-question scoring and feedback
- Overall performance summary
- Recommended next steps
- Behavioural analysis section for focus warnings and filler usage

## Screenshots

You mentioned that you want to add screenshots. The README is ready for that.

Recommended screenshot directory:

```text
docs/screenshots/
```

Recommended filenames:

```text
docs/screenshots/setup-screen.png
docs/screenshots/dashboard.png
docs/screenshots/session-view.png
docs/screenshots/settings.png
docs/screenshots/report-preview.png
```

Once you add those images, this section will render nicely on GitHub:

```md
## Screenshots

### First-Time Setup
![First-Time Setup](docs/screenshots/setup-screen.png)

### Dashboard
![Dashboard](docs/screenshots/dashboard.png)

### Interview Session
![Interview Session](docs/screenshots/session-view.png)

### Settings
![Settings](docs/screenshots/settings.png)

### PDF Report
![PDF Report](docs/screenshots/report-preview.png)
```

If you want, I can also add the screenshot section directly into the README with placeholders right now. At the moment I am leaving it documented cleanly so the README does not show broken image links.

## Architecture

The project is split into two main layers:

### 1. Electron Desktop Layer

Responsible for:

- window management
- onboarding and login UI
- dashboard and settings UI
- device selection
- IPC communication with the Python engine
- packaged installer behavior

Primary files:

- `main.js`
- `renderer.js`
- `index.html`
- `assets/style.css`

### 2. Python AI Engine

Responsible for:

- session state management
- AI question generation
- Groq Whisper transcription
- follow-up question logic
- report evaluation
- PDF report generation

Primary file:

- `engine/app.py`

Communication between Electron and Python is done through process messaging over stdin/stdout.

## Technology Stack

### Frontend / Desktop

- Electron
- HTML
- CSS
- JavaScript

### Python Engine

- Python
- Groq SDK
- NumPy
- sounddevice
- python-dotenv
- ReportLab
- Pillow

### Packaging

- PyInstaller
- electron-builder

## Project Structure

```text
.
|-- assets/
|   |-- icon.ico
|   `-- style.css
|-- build/
|   `-- installer.nsh
|-- engine/
|   |-- app.py
|   |-- engine.spec
|   `-- runtime_hook_ssl.py
|-- index.html
|-- main.js
|-- renderer.js
|-- requirements.txt
|-- package.json
|-- build.bat
`-- LICENSE.txt
```

## Application Flow

### First Launch

1. The application starts and checks for a locally saved Groq API key.
2. If no valid key exists, the user sees the onboarding/setup screen.
3. The user enters a Groq API key to enable AI features.
4. The app stores the key locally and starts the Python engine.

### Returning User

1. The app loads the saved user profile and API key.
2. The dashboard opens after login.
3. The user selects interview topics and difficulty.
4. The session starts in fullscreen interview mode.

### During Session

1. The engine asks one interview question at a time.
2. The user answers verbally or through the code editor.
3. The engine transcribes speech and builds contextual follow-up prompts.
4. Focus and behaviour signals are tracked.

### End of Session

1. The user ends the session.
2. The engine finalizes the Q&A set.
3. The report is evaluated and converted into PDF form.
4. The generated PDF is opened automatically.

## First-Time Setup

The application intentionally asks new users for a Groq API key during onboarding.

This behavior is expected and by design.

Why this is required:

- the application does not embed a shared production API key
- shipping a shared API key inside a desktop app is insecure
- each user authenticates AI usage through their own Groq account

Saved configuration path:

```text
%AppData%\AI Mock Interview Assistant\config.json
```

Saved user profile path:

```text
%AppData%\AI Mock Interview Assistant\user.json
```

## Local Development

### Prerequisites

- Windows
- Node.js and npm
- Python 3.x

### Install Dependencies

```powershell
npm install
python -m venv venv
venv\Scripts\pip install -r requirements.txt
```

### Run in Development

```powershell
npm start
```

## Build and Packaging

The project includes a Windows build pipeline that packages:

- the Python engine with PyInstaller
- the Electron application with electron-builder

### Build Script

Use:

```powershell
build.bat
```

### What the Build Script Does

1. checks for Python and npm
2. installs Node.js dependencies
3. creates the Python virtual environment
4. installs Python dependencies and PyInstaller
5. bundles the Python engine from `engine/engine.spec`
6. builds the Windows installer through Electron Builder

### Installer Output

```text
dist-installer\AI-Mock-Interview-Assistant-Setup-v2.0.0.exe
```

## PDF Reports

The application generates a PDF report after the interview session ends.

Report contents include:

- candidate name
- interview topics
- difficulty level
- question count
- filler word count
- focus warning count
- overall rating
- per-question score
- feedback and improvement tips
- behavioural analysis
- recommended next steps

### Report Storage

Reports are saved to the app's writable user-data area rather than the packaged engine directory.

### Product Sans Support

The PDF generator supports Product Sans automatically when these files are available:

```text
engine/fonts/ProductSans-Regular.ttf
engine/fonts/ProductSans-Bold.ttf
```

If those font files are not present, the PDF generator falls back to Helvetica automatically.

## Configuration and Data Storage

### Local Files

- API key: `%AppData%\AI Mock Interview Assistant\config.json`
- user profile: `%AppData%\AI Mock Interview Assistant\user.json`
- reports: `%AppData%\AI Mock Interview Assistant\reports\`
- crash log: `%AppData%\AI Mock Interview Assistant\engine-crash.log`
- stderr log: `%AppData%\AI Mock Interview Assistant\engine-stderr.log`

### Privacy Notes

- user profile data is stored locally
- API keys are stored locally
- reports are generated locally
- no application-owned backend is included in this repository
- AI requests are sent through the user's own Groq account

## Troubleshooting

### `pyinstaller` is not recognized

Use the provided `build.bat`. The script installs and executes PyInstaller from the project virtual environment directly.

### Invalid API key or `401 invalid_api_key`

- verify that the saved key is a valid Groq key
- the key should begin with `gsk_`
- update the key from the in-app Settings screen

### Session does not start

- make sure at least one interview topic is selected
- make sure the Python engine is running
- rebuild the packaged app if the engine bundle is outdated or missing

### Report PDF is not generated

Check:

```text
%AppData%\AI Mock Interview Assistant\engine-crash.log
%AppData%\AI Mock Interview Assistant\engine-stderr.log
```

Recent versions store reports in the app data directory, not inside the packaged `engine` folder.

## Roadmap

Potential future improvements:

- screenshot-rich GitHub presentation
- refined onboarding UX
- more interview packs and curated content
- stronger report visualization and analytics
- optional managed backend mode
- export/import of session history

## Author

Ved Sharanagate  
Email: `vedsharangate@gmail.com`

## License

This repository is a **proprietary private project**.

It is **not open source**.

Please read [LICENSE.txt](LICENSE.txt) for the exact legal terms. In summary:

- personal and educational use only
- no redistribution without permission
- no commercial use without permission
- no modification or derivative sharing without permission

