const { ipcRenderer, shell } = require('electron');
const fs = require('fs');

// --- GLOBAL ENGINE ERROR TOAST ---
// Shows a red banner on ANY screen so engine errors are never silently lost.
let _toastTimer = null;
function showEngineError(msg) {
    const el = document.getElementById('engine-toast');
    if (!el) return;
    el.innerText = '⚠ ' + msg;
    el.style.display = 'block';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 8000);
}

let mediaStream = null;
let audioContext = null;
let selectedCameraId = null;
let selectedMicId = null;

// --- SESSION TIMER STATE ---
let sessionTimerInterval = null;
let sessionSeconds = 0;
let sessionPaused = false;
let sessionActive = false;   // true while an interview session is running

// --- AUTO SCROLL STATE ---
let autoScrollEnabled = true;   // false when user manually scrolls up

// --- CODE EDITOR STATE ---
let codeTimerInterval = null;
let codeSeconds = 0;
let awaitingCode = false;       // true while code editor is open

const CODE_KEYWORDS = /\b(write|implement|code|function|program|snippet|algorithm|debug|fix|solution|class|method|script|recursive|recursion|loop|sort|search|binary|linked.?list|stack|queue|tree|graph|hash)\b/i;

function isCodeQuestion(text) {
    return CODE_KEYWORDS.test(text);
}

function showCodeEditor() {
    if (awaitingCode) return;
    awaitingCode = true;
    codeSeconds = 0;

    // Pause mic + cancel any pending followup timer in engine
    ipcRenderer.send('ai-send', JSON.stringify({ type: "PAUSE_LISTENING" }));

    // Set default language from session topics
    const langMap = { python:'Python', java:'Java', javascript:'JavaScript',
                      'c++':'C++', 'c#':'C#', sql:'SQL', typescript:'TypeScript',
                      go:'Go', react:'JavaScript', 'node.js':'JavaScript' };
    const langSel = document.getElementById('code-lang-select');
    if (langSel && selected.length) {
        const match = selected.map(s => s.toLowerCase()).find(s => langMap[s]);
        if (match) langSel.value = langMap[match];
    }

    // Clear textarea and show panel
    const input = document.getElementById('code-input');
    const panel = document.getElementById('code-editor-panel');
    if (input) { input.value = ''; updateLineNumbers(); }
    if (panel) panel.style.display = 'flex';

    // Start code timer
    updateCodeTimer();
    if (codeTimerInterval) clearInterval(codeTimerInterval);
    codeTimerInterval = setInterval(() => { codeSeconds++; updateCodeTimer(); }, 1000);

    autoScrollEnabled = true;
    scrollToBottom();
    setTimeout(() => { const inp = document.getElementById('code-input'); if (inp) inp.focus(); }, 80);
}

function hideCodeEditor() {
    awaitingCode = false;
    const panel = document.getElementById('code-editor-panel');
    if (panel) panel.style.display = 'none';
    if (codeTimerInterval) { clearInterval(codeTimerInterval); codeTimerInterval = null; }
}

function updateCodeTimer() {
    const m = Math.floor(codeSeconds / 60), s = codeSeconds % 60;
    const el = document.getElementById('code-timer');
    if (el) el.innerText = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateLineNumbers() {
    const textarea = document.getElementById('code-input');
    const nums = document.getElementById('code-line-nums');
    if (!textarea || !nums) return;
    const lines = textarea.value.split('\n').length;
    nums.innerText = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
}

function submitCode() {
    const input = document.getElementById('code-input');
    if (!input) return;
    const code = input.value.trim();
    if (!code) {
        input.focus();
        input.style.boxShadow = 'inset 0 0 0 2px var(--red)';
        setTimeout(() => { input.style.boxShadow = ''; }, 1200);
        return;
    }

    const lang = (document.getElementById('code-lang-select') || {}).value || '';
    addUserCodeBubble(code, lang);

    // Send to engine as a code answer (engine will treat as transcript final)
    ipcRenderer.send('ai-send', JSON.stringify({ type: "CODE_ANSWER", code: code, lang: lang }));

    hideCodeEditor();
    scrollToBottom();
}

function addUserCodeBubble(code, lang) {
    const box = document.getElementById('transcript-box');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'chat-bubble user code-answer';
    const header = lang ? `<span style="font-size:10px;opacity:0.5;font-family:var(--font-mono);display:block;margin-bottom:6px;">${escapeHtml(lang)}</span>` : '';
    div.innerHTML = header + `<pre class="code-block">${escapeHtml(code)}</pre>`;
    box.appendChild(div);
    scrollToBottom();
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// --- TTS STATE ---
let ttsEnabled  = true;
let ttsRate     = 1.0;
let ttsPitch    = 1.0;
let ttsVoiceURI = '';

// Pre-load system voices (they load asynchronously in Chromium)
if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
        const sel = document.getElementById('tts-voice-select');
        if (sel) populateTtsVoices();
    };
}

// --- CHEATING DETECTION ---
let cheatWarningCount = 0;
let faceDetectionInterval = null;
let lastFaceAlertTime = 0;
let focusEvents = [];          // [{time:"01:23", desc:"..."}]
const CHEAT_COOLDOWN_MS = 9000;

function _elapsedLabel() {
    const m = Math.floor(sessionSeconds / 60), s = sessionSeconds % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function triggerCheatWarning(msg) {
    if (!sessionActive || sessionPaused) return;
    const now = Date.now();
    if (now - lastFaceAlertTime < CHEAT_COOLDOWN_MS) return;
    lastFaceAlertTime = now;
    cheatWarningCount++;
    focusEvents.push({ time: _elapsedLabel(), desc: msg });

    const banner  = document.getElementById('cheat-warning');
    const msgEl   = document.getElementById('cheat-warning-msg');
    const countEl = document.getElementById('cheat-warning-count');
    const iconEl  = document.getElementById('cheat-warning-icon');
    if (!banner) return;

    const isFinal   = cheatWarningCount >= 7;
    const isSerious = cheatWarningCount >= 4;
    banner.className = isFinal   ? 'cheat-banner cheat-final'
                     : isSerious ? 'cheat-banner cheat-serious'
                     :             'cheat-banner';
    if (iconEl) iconEl.innerText = isFinal ? '🚨' : isSerious ? '🔴' : '⚠️';
    msgEl.innerText   = isFinal
        ? `FINAL WARNING (#${cheatWarningCount}): ${msg} This is being recorded.`
        : msg;
    countEl.innerText = cheatWarningCount;
    banner.style.display = 'flex';

    if (!isFinal) {
        clearTimeout(banner._autoHide);
        banner._autoHide = setTimeout(() => { banner.style.display = 'none'; }, 6000);
    }
    // Final warning stays until explicitly dismissed
}

function dismissCheatWarning() {
    const banner = document.getElementById('cheat-warning');
    if (banner) { clearTimeout(banner._autoHide); banner.style.display = 'none'; }
}

// Window-focus / tab-switch detection
document.addEventListener('visibilitychange', () => {
    if (document.hidden) triggerCheatWarning('Tab switch detected — stay on the interview screen!');
});
window.addEventListener('blur', () => {
    triggerCheatWarning('Window focus lost — stay on the interview screen!');
});

// Canvas-based face presence detection (works in Electron without extra flags)
async function _analyzeFacePresence() {
    const video = document.getElementById('session-cam');
    if (!video || video.readyState < 2 || video.videoWidth === 0) return 'unknown';
    try {
        const W = 80, H = 60;
        const off = new OffscreenCanvas(W, H);
        const ctx = off.getContext('2d');
        ctx.drawImage(video, 0, 0, W, H);
        // Sample upper-centre region where face typically sits
        const px = ctx.getImageData(20, 4, 40, 32).data;
        let skinN = 0, darkN = 0, total = 0;
        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i+1], b = px[i+2];
            total++;
            if (r < 25 && g < 25 && b < 25) { darkN++; continue; }
            // Broad skin-tone range across complexions
            if (r > 60 && g > 25 && b > 10 && r > b && r >= g &&
                (r - Math.min(g,b)) > 10 && r < 250) skinN++;
        }
        if (darkN / total > 0.75) return 'dark';      // camera covered / facing away
        if (skinN / total < 0.04) return 'no_face';   // no face in frame
        return 'face_present';
    } catch (_) { return 'unknown'; }
}

async function startFaceDetection() {
    faceDetectionInterval = setInterval(async () => {
        if (!sessionActive || sessionPaused) return;
        const result = await _analyzeFacePresence();
        if (result === 'dark')
            triggerCheatWarning('Camera appears covered or very dark — keep your face visible!');
        else if (result === 'no_face')
            triggerCheatWarning('Face not detected — please look at the screen!');
    }, 5000);
}

function stopFaceDetection() {
    if (faceDetectionInterval) { clearInterval(faceDetectionInterval); faceDetectionInterval = null; }
}

// --- TOPICS & STUDY RESOURCES ---
const TOPIC_CATEGORIES = {
    'Languages':   ['Python', 'Java', 'JavaScript', 'C++', 'C#', 'SQL'],
    'CS Core':     ['Data Structures', 'Algorithms', 'System Design', 'OOP', 'OS', 'DBMS'],
    'Frameworks':  ['React', 'Node.js', 'Angular', 'Machine Learning', 'DevOps'],
    'Soft Skills': ['HR Questions', 'Behavioral', 'Leadership', 'Teamwork'],
};
let TOPICS = Object.values(TOPIC_CATEGORIES).flat();
let selected = [];
let currentCategory = 'All';
let liveBubble = null;
let tipInterval = null;

function _yt(q) { return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`; }

const STUDY_RESOURCES = {
    'Python':           [
        { icon:'🎬', yt:true,  label:'Python Interview Q&A',    url: _yt('python interview questions answers 2025') },
        { icon:'🎬', yt:true,  label:'Python Full Course',       url: _yt('python tutorial for beginners full course freeCodeCamp') },
        { icon:'📖', yt:false, label:'GeeksForGeeks Python',     url: 'https://www.geeksforgeeks.org/python-programming-language/' },
        { icon:'📝', yt:false, label:'Official Python Docs',     url: 'https://docs.python.org/3/tutorial/' },
    ],
    'Java':             [
        { icon:'🎬', yt:true,  label:'Java Interview Q&A',       url: _yt('java interview questions answers') },
        { icon:'🎬', yt:true,  label:'Java Full Course',          url: _yt('java programming full course beginners') },
        { icon:'📖', yt:false, label:'GeeksForGeeks Java',        url: 'https://www.geeksforgeeks.org/java/' },
        { icon:'📝', yt:false, label:'Oracle Java Tutorial',      url: 'https://docs.oracle.com/javase/tutorial/' },
    ],
    'JavaScript':       [
        { icon:'🎬', yt:true,  label:'JS Interview Q&A',         url: _yt('javascript interview questions answers') },
        { icon:'🎬', yt:true,  label:'JS Full Course',            url: _yt('javascript full course beginners Bro Code') },
        { icon:'📖', yt:false, label:'MDN Web Docs',              url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide' },
        { icon:'📝', yt:false, label:'JavaScript.info',           url: 'https://javascript.info/' },
    ],
    'C++':              [
        { icon:'🎬', yt:true,  label:'C++ Interview Q&A',        url: _yt('c++ interview questions answers') },
        { icon:'🎬', yt:true,  label:'C++ Full Course',           url: _yt('c++ full course beginners') },
        { icon:'📖', yt:false, label:'GFG C++',                   url: 'https://www.geeksforgeeks.org/c-plus-plus/' },
        { icon:'📝', yt:false, label:'cppreference.com',          url: 'https://en.cppreference.com/' },
    ],
    'C#':               [
        { icon:'🎬', yt:true,  label:'C# Interview Q&A',         url: _yt('c sharp interview questions answers') },
        { icon:'🎬', yt:true,  label:'C# Full Course',            url: _yt('c sharp tutorial complete course') },
        { icon:'📖', yt:false, label:'GFG C#',                    url: 'https://www.geeksforgeeks.org/csharp-programming-language/' },
        { icon:'📝', yt:false, label:'Microsoft C# Docs',         url: 'https://docs.microsoft.com/en-us/dotnet/csharp/' },
    ],
    'SQL':              [
        { icon:'🎬', yt:true,  label:'SQL Interview Q&A',        url: _yt('sql interview questions answers') },
        { icon:'🎬', yt:true,  label:'SQL Full Course',           url: _yt('sql tutorial complete beginners') },
        { icon:'📖', yt:false, label:'GFG SQL',                   url: 'https://www.geeksforgeeks.org/sql-tutorial/' },
        { icon:'📝', yt:false, label:'W3Schools SQL',             url: 'https://www.w3schools.com/sql/' },
    ],
    'Data Structures':  [
        { icon:'🎬', yt:true,  label:'DSA Interview Prep',        url: _yt('data structures algorithms interview questions') },
        { icon:'🎬', yt:true,  label:'DSA Full Course',            url: _yt('data structures and algorithms full course') },
        { icon:'📖', yt:false, label:'GFG DSA',                   url: 'https://www.geeksforgeeks.org/data-structures/' },
        { icon:'📝', yt:false, label:'Visualgo (Interactive)',     url: 'https://visualgo.net/' },
    ],
    'Algorithms':       [
        { icon:'🎬', yt:true,  label:'Algorithms Q&A',            url: _yt('algorithms interview questions answers') },
        { icon:'🎬', yt:true,  label:'Abdul Bari Algorithms',     url: 'https://www.youtube.com/playlist?list=PLDN4rrl48XKpZkf03iYFl-O29szjTrs_O' },
        { icon:'📖', yt:false, label:'GFG Algorithms',            url: 'https://www.geeksforgeeks.org/fundamentals-of-algorithms/' },
        { icon:'📝', yt:false, label:'LeetCode Learn',            url: 'https://leetcode.com/explore/learn/' },
    ],
    'System Design':    [
        { icon:'🎬', yt:true,  label:'System Design Interview',   url: _yt('system design interview questions answers') },
        { icon:'🎬', yt:true,  label:'Gaurav Sen Playlist',       url: 'https://www.youtube.com/playlist?list=PLMCXHnjXnTnvo6alSjVkgxV-VH6EPyvoX' },
        { icon:'📖', yt:false, label:'System Design Primer',      url: 'https://github.com/donnemartin/system-design-primer' },
        { icon:'📝', yt:false, label:'High Scalability Blog',     url: 'http://highscalability.com/' },
    ],
    'OOP':              [
        { icon:'🎬', yt:true,  label:'OOP Interview Q&A',        url: _yt('oops object oriented programming interview questions') },
        { icon:'📖', yt:false, label:'GFG OOPs Concepts',        url: 'https://www.geeksforgeeks.org/object-oriented-programming-oops-concept-in-java/' },
    ],
    'OS':               [
        { icon:'🎬', yt:true,  label:'OS Interview Q&A',         url: _yt('operating system interview questions answers') },
        { icon:'📖', yt:false, label:'GFG Operating Systems',    url: 'https://www.geeksforgeeks.org/operating-systems/' },
    ],
    'DBMS':             [
        { icon:'🎬', yt:true,  label:'DBMS Interview Q&A',       url: _yt('dbms interview questions answers') },
        { icon:'📖', yt:false, label:'GFG DBMS',                  url: 'https://www.geeksforgeeks.org/dbms/' },
    ],
    'React':            [
        { icon:'🎬', yt:true,  label:'React Interview Q&A',      url: _yt('react interview questions answers 2025') },
        { icon:'🎬', yt:true,  label:'React Crash Course',        url: _yt('react js full course beginners') },
        { icon:'📖', yt:false, label:'Official React Docs',       url: 'https://react.dev/' },
        { icon:'📝', yt:false, label:'30 Days of React',          url: 'https://github.com/Asabeneh/30-Days-Of-React' },
    ],
    'Node.js':          [
        { icon:'🎬', yt:true,  label:'Node.js Interview Q&A',    url: _yt('nodejs interview questions answers') },
        { icon:'🎬', yt:true,  label:'Node.js Crash Course',      url: _yt('nodejs crash course traversy') },
        { icon:'📖', yt:false, label:'Node.js Docs',              url: 'https://nodejs.org/en/docs/' },
    ],
    'Angular':          [
        { icon:'🎬', yt:true,  label:'Angular Interview Q&A',    url: _yt('angular interview questions answers') },
        { icon:'📖', yt:false, label:'Angular Official Docs',     url: 'https://angular.io/docs' },
    ],
    'Machine Learning': [
        { icon:'🎬', yt:true,  label:'ML Interview Q&A',         url: _yt('machine learning interview questions answers') },
        { icon:'🎬', yt:true,  label:'ML Full Course (fCC)',      url: 'https://www.youtube.com/watch?v=NWONeJKn9Kc' },
        { icon:'📖', yt:false, label:'GFG Machine Learning',      url: 'https://www.geeksforgeeks.org/machine-learning/' },
        { icon:'📝', yt:false, label:'fast.ai Practical ML',      url: 'https://www.fast.ai/' },
    ],
    'DevOps':           [
        { icon:'🎬', yt:true,  label:'DevOps Interview Q&A',     url: _yt('devops interview questions answers') },
        { icon:'🎬', yt:true,  label:'DevOps Roadmap 2025',      url: _yt('devops roadmap tutorial 2025') },
        { icon:'📖', yt:false, label:'GFG DevOps',               url: 'https://www.geeksforgeeks.org/devops-tutorial/' },
    ],
    'HR Questions':     [
        { icon:'🎬', yt:true,  label:'HR Interview Q&A',         url: _yt('hr interview questions answers for freshers') },
        { icon:'📖', yt:false, label:'Common HR Questions',       url: 'https://www.geeksforgeeks.org/hr-interview-questions/' },
    ],
    'Behavioral':       [
        { icon:'🎬', yt:true,  label:'Behavioral Interview (STAR)',url: _yt('behavioral interview questions STAR method answers') },
        { icon:'📝', yt:false, label:'STAR Method Guide',         url: 'https://www.themuse.com/advice/star-interview-method' },
    ],
    'Leadership':       [
        { icon:'🎬', yt:true,  label:'Leadership Interview Q&A', url: _yt('leadership interview questions answers') },
        { icon:'📖', yt:false, label:'GFG Leadership Questions',  url: 'https://www.geeksforgeeks.org/leadership-interview-questions/' },
    ],
    'Teamwork':         [
        { icon:'🎬', yt:true,  label:'Teamwork Interview Q&A',   url: _yt('teamwork collaboration interview questions') },
        { icon:'📖', yt:false, label:'GFG Teamwork Questions',    url: 'https://www.geeksforgeeks.org/teamwork-interview-questions/' },
    ],
};

// --- WINDOW CONTROLS ---
document.getElementById('btn-min').onclick = () => ipcRenderer.send('minimize-window');
document.getElementById('btn-max').onclick = () => ipcRenderer.send('maximize-window');
document.getElementById('btn-close').onclick = () => ipcRenderer.send('close-window');

// --- INITIALIZATION ---
window.onload = () => setTimeout(checkFirstRun, 1200);

async function checkFirstRun() {
    const hasKey = await ipcRenderer.invoke('check-api-key');
    if (!hasKey) {
        // No API key saved yet — show setup screen
        document.getElementById('splash-view').style.display = 'none';
        document.getElementById('setup-view').style.display = 'flex';
        return;
    }
    checkAutoLogin();
}

async function checkAutoLogin() {
    document.getElementById('splash-view').style.display = 'none';
    try {
        const data = await ipcRenderer.invoke('get-user-profile');
        const savedName = (data.name || '').trim();
        if (savedName) {
            setupDashboard(savedName);
            return;
        }
    } catch (e) {
        console.error("Login file error", e);
    }
    showLoginView();
}

function clearSetupWarning() {
    const w = document.getElementById('setup-warning');
    const i = document.getElementById('api-key-input');
    if (w) w.style.display = 'none';
    if (i) i.classList.remove('invalid');
}

function saveApiKey() {
    const input = document.getElementById('api-key-input');
    const key = (input.value || '').trim();
    if (!key || !key.startsWith('gsk_') || key.length < 20) {
        const w = document.getElementById('setup-warning');
        w.innerText = 'Please enter a valid Groq API key (starts with gsk_).';
        w.style.display = 'block';
        input.classList.add('invalid');
        return;
    }
    ipcRenderer.send('save-api-key', key);
    document.getElementById('setup-view').style.display = 'none';
    document.getElementById('splash-view').style.display = 'flex';
    setTimeout(checkAutoLogin, 800);
}


function clearLoginWarning() {
    const warning = document.getElementById('login-warning');
    const input = document.getElementById('login_name');
    if (warning) warning.style.display = 'none';
    if (input) input.classList.remove('invalid');
}

function showLoginWarning(message = 'Please enter your name to access the dashboard.') {
    const warning = document.getElementById('login-warning');
    const input = document.getElementById('login_name');
    if (warning) {
        warning.innerText = message;
        warning.style.display = 'block';
    }
    if (input) {
        input.classList.add('invalid');
        input.focus();
    }
}

function handleLoginKey(event) {
    if (event.key === 'Enter') {
        performLogin();
    }
}

function showLoginView() {
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('session-view').style.display = 'none';
    document.getElementById('settings-modal').style.display = 'none';
    document.getElementById('session-loader').style.display = 'none';
    document.getElementById('login-view').style.display = 'flex';

    const input = document.getElementById('login_name');
    input.value = '';
    input.disabled = false;
    clearLoginWarning();
    setTimeout(() => input.focus(), 0);
}

async function performLogin() {
    const input = document.getElementById('login_name');
    const name = input.value.trim();
    if (!name) {
        showLoginWarning();
        return;
    }

    clearLoginWarning();

    try {
        await ipcRenderer.invoke('save-user-profile', name);
    } catch (e) {
        console.error('Failed to save login profile:', e);
        showLoginWarning('Could not save your profile. Please try again.');
        return;
    }

    setupDashboard(name);
}

function stopHardware() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
    }
    updateCamStatus(false);
    const bar = document.getElementById('audio-bar');
    if (bar) bar.style.width = '0%';
}

function logoutUser() {
    if (confirm("Are you sure you want to sign out? Data will be cleared.")) {
        stopHardware();
        ipcRenderer.invoke('clear-user-profile')
            .catch((e) => console.error('Failed to clear login profile:', e))
            .finally(() => showLoginView());
    }
}

async function setupDashboard(name) {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard-view').style.display = 'flex';
    document.getElementById('disp_name').innerText = name;

    document.getElementById('cam-switch').checked = true;
    document.getElementById('mic-switch').checked = true;
    await startHardware();

    ipcRenderer.send('ai-send', JSON.stringify({ type: "GET_TOPICS" }));
    renderTopicList();   // draw topic list immediately with default topics
}

function openExternal(url) {
    shell.openExternal(url);
}

// --- HARDWARE HANDLING ---
function getAudioConstraint() {
    return selectedMicId ? { deviceId: { exact: selectedMicId } } : true;
}

async function startHardware() {
    try {
        stopHardware();
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
            audio: getAudioConstraint()
        });
        const activeVideoTrack = mediaStream.getVideoTracks()[0];
        const activeAudioTrack = mediaStream.getAudioTracks()[0];
        if (activeVideoTrack) {
            selectedCameraId = activeVideoTrack.getSettings().deviceId || selectedCameraId;
        }
        if (activeAudioTrack) {
            selectedMicId = activeAudioTrack.getSettings().deviceId || selectedMicId;
            activeAudioTrack.enabled = document.getElementById('mic-switch').checked;
        }
        document.getElementById('dash-cam').srcObject = mediaStream;
        updateCamStatus(!!activeVideoTrack);
        initAudioVisualizer(mediaStream);
    } catch (err) {
        console.error("Hardware Access Error:", err);
        updateCamStatus(false);
    }
}

async function toggleCamera(chk) {
    if (!chk.checked) {
        if (mediaStream) mediaStream.getVideoTracks().forEach(t => t.stop());
        updateCamStatus(false);
        return;
    }

    try {
        const videoConstraint = selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true;
        const newStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
        const videoTrack = newStream.getVideoTracks()[0];
        if (!videoTrack) throw new Error('No camera track available');

        selectedCameraId = videoTrack.getSettings().deviceId || selectedCameraId;
        const audioTracks = mediaStream ? mediaStream.getAudioTracks() : [];
        if (mediaStream) {
            mediaStream.getVideoTracks().forEach(t => t.stop());
        }
        mediaStream = new MediaStream([videoTrack, ...audioTracks]);

        document.getElementById('dash-cam').srcObject = mediaStream;
        const sessionCam = document.getElementById('session-cam');
        if (sessionCam) sessionCam.srcObject = mediaStream;
        updateCamStatus(true);
    } catch (e) {
        console.error(e);
        chk.checked = false;
    }
}

function toggleMic(chk) {
    if (mediaStream && mediaStream.getAudioTracks().length > 0) {
        mediaStream.getAudioTracks().forEach(track => {
            track.enabled = chk.checked;
        });
    }
}

function updateCamStatus(active) {
    const dot = document.getElementById('cam-dot');
    const txt = document.getElementById('cam-txt');
    if (active) {
        dot.classList.add('active');
        txt.innerText = "Camera Active";
        txt.style.color = "#00ff88"; // Hardcoded green for safety
    } else {
        dot.classList.remove('active');
        txt.innerText = "Camera Off";
        txt.style.color = "#888";
    }
}

function initAudioVisualizer(stream) {
    if (audioContext) return;
    audioContext = new AudioContext();
    const src = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 32;
    src.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function animate() {
        const micOn = document.getElementById('mic-switch').checked;
        let pct = 0;
        if (micOn) {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            pct = Math.min(100, (sum / dataArray.length) * 3);
        }
        const bar = document.getElementById('audio-bar');
        if (bar) bar.style.width = pct + '%';
        const sBar = document.getElementById('session-audio-bar');
        if (sBar) sBar.style.width = pct + '%';
        requestAnimationFrame(animate);
    }
    animate();
}

// --- TTS ---
function speakQuestion(text) {
    if (!ttsEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(text);
    utt.rate   = ttsRate;
    utt.pitch  = ttsPitch;
    if (ttsVoiceURI) {
        const v = window.speechSynthesis.getVoices().find(v => v.voiceURI === ttsVoiceURI);
        if (v) utt.voice = v;
    }
    // Pause STT while the AI is speaking so its voice isn't picked up as the user's answer
    utt.onstart = () => ipcRenderer.send('ai-send', JSON.stringify({ type: "PAUSE_LISTENING" }));
    utt.onend   = () => {
        if (!sessionPaused) {
            ipcRenderer.send('ai-send', JSON.stringify({ type: "RESUME_LISTENING" }));
        }
    };
    utt.onerror = () => {
        if (!sessionPaused) {
            ipcRenderer.send('ai-send', JSON.stringify({ type: "RESUME_LISTENING" }));
        }
    };
    window.speechSynthesis.speak(utt);
}

function toggleTts(chk) {
    ttsEnabled = chk.checked;
    if (!ttsEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
}

function setTtsSpeed(input) {
    ttsRate = parseFloat(input.value);
    const lbl = document.getElementById('tts-speed-lbl');
    if (lbl) lbl.innerText = ttsRate.toFixed(1) + '×';
}

function setTtsPitch(input) {
    ttsPitch = parseFloat(input.value);
    const lbl   = document.getElementById('tts-pitch-lbl');
    if (!lbl) return;
    const v = ttsPitch;
    lbl.innerText = v <= 0.65 ? 'Deep' : v <= 0.9 ? 'Low' : v <= 1.15 ? 'Normal' : v <= 1.45 ? 'High' : 'Higher';
}

function setTtsVoice(select) {
    ttsVoiceURI = select.value;
}

function populateTtsVoices() {
    const sel = document.getElementById('tts-voice-select');
    if (!sel || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;             // not loaded yet — onvoiceschanged will retry
    sel.innerHTML = '';
    const def = document.createElement('option');
    def.value = ''; def.textContent = '— Default System Voice —';
    sel.appendChild(def);
    voices.filter(v => v.lang.startsWith('en')).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})`;
        if (v.voiceURI === ttsVoiceURI) opt.selected = true;
        sel.appendChild(opt);
    });
    sel.value = ttsVoiceURI || '';
}

// --- TOPIC BROWSER ---
function setCategoryTab(el, cat) {
    currentCategory = cat;
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderTopicList();
}

function renderTopicList() {
    const grid = document.getElementById('topic-chips-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const topics = currentCategory === 'All' ? TOPICS : (TOPIC_CATEGORIES[currentCategory] || []);
    topics.forEach(t => {
        const item = document.createElement('button');
        item.className = 'topic-item' + (selected.includes(t) ? ' selected' : '');
        item.innerHTML = `<span class="topic-dot"></span>${t}`;
        item.title = t;
        item.onclick = () => toggleTopicItem(t, item);
        grid.appendChild(item);
    });
    _updateSelectedBadge();
}

function toggleTopicItem(t, el) {
    if (selected.includes(t)) {
        selected = selected.filter(x => x !== t);
        el.classList.remove('selected');
    } else {
        selected.push(t);
        el.classList.add('selected');
    }
    document.getElementById('btn-start').disabled = selected.length === 0;
    _updateSelectedBadge();
    _updateStudyTab();
    const studyContent = document.getElementById('rp-study');
    if (studyContent && !studyContent.classList.contains('hidden')) {
        _buildStudyCards(document.getElementById('study-cards-container'));
    }
}

function _updateSelectedBadge() {
    const el = document.getElementById('selected-count');
    if (!el) return;
    el.style.opacity = selected.length ? '1' : '0';
    el.innerText = `${selected.length} selected`;
}

function _updateStudyTab() {
    const empty = document.getElementById('study-empty-state');
    const container = document.getElementById('study-cards-container');
    if (!empty || !container) return;
    if (selected.length === 0) {
        empty.style.display = 'flex';
        container.style.display = 'none';
    } else {
        empty.style.display = 'none';
        container.style.display = 'flex';
    }
}

function _buildStudyCards(container) {
    container.innerHTML = '';
    selected.forEach(topic => {
        const resources = STUDY_RESOURCES[topic] || [
            { icon:'\uD83C\uDFA6', yt:true,  label:`${topic} Interview Questions`, url: _yt(`${topic} interview questions answers`) },
            { icon:'\uD83D\uDCD6', yt:false, label:'GeeksForGeeks',                url: `https://www.geeksforgeeks.org/${encodeURIComponent(topic.toLowerCase().replace(/ /g,'-'))}/` },
            { icon:'\uD83D\uDD0D', yt:false, label:'Google Search Notes',          url: `https://www.google.com/search?q=${encodeURIComponent(topic+' interview notes')}` },
        ];
        const btns = resources.map(r =>
            `<button class="study-link-btn${r.yt ? ' yt' : ''}" onclick="openExternal('${r.url.replace(/'/g,"%27")}')">${r.icon} ${r.label}</button>`
        ).join('');
        const card = document.createElement('div');
        card.className = 'study-card';
        card.innerHTML = `<div class="study-card-title">${topic}</div><div class="study-links">${btns}</div>`;
        container.appendChild(card);
    });
}

function switchRpTab(tabName) {
    ['configure', 'study'].forEach(t => {
        document.getElementById(`rp-${t}`).classList.toggle('hidden', t !== tabName);
        const btn = document.getElementById(`tab-btn-${t}`);
        if (btn) btn.classList.toggle('active', t === tabName);
    });
    if (tabName === 'study') {
        _updateStudyTab();
        if (selected.length > 0)
            _buildStudyCards(document.getElementById('study-cards-container'));
    }
}

function removeTag(t) {
    selected = selected.filter(x => x !== t);
    renderTopicList();
    _updateStudyTab();
    if (selected.length === 0)
        document.getElementById('btn-start').disabled = true;
}

function updateDiff(rng) {
    const lvl = ["Beginner", "Intermediate", "Expert"];
    document.getElementById('diff-lbl').innerText = lvl[rng.value - 1];
}

// --- SETTINGS MODAL ---
function toggleSettings(show) {
    document.getElementById('settings-modal').style.display = show ? 'flex' : 'none';
    if (show) {
        populateDevices();
        populateTtsVoices();
        // Sync TTS UI state to current values
        const toggle = document.getElementById('tts-toggle');
        if (toggle) toggle.checked = ttsEnabled;
        const spd = document.getElementById('tts-speed-range');
        if (spd) { spd.value = ttsRate; setTtsSpeed(spd); }
        const pitch = document.getElementById('tts-pitch-range');
        if (pitch) { pitch.value = ttsPitch; setTtsPitch(pitch); }
        const camSelect = document.getElementById('cam-select');
        const micSelect = document.getElementById('mic-select');
        camSelect.onchange = (e) => applyCameraSource(e.target.value);
        micSelect.onchange = (e) => applyMicSource(e.target.value);
    }
}

async function populateDevices() {
    const cSelect = document.getElementById('cam-select');
    const mSelect = document.getElementById('mic-select');
    cSelect.innerHTML = "";
    mSelect.innerHTML = "";
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.innerText = d.label || `Device ${d.kind}`;
        if (d.kind === 'videoinput') cSelect.appendChild(opt);
        else if (d.kind === 'audioinput') mSelect.appendChild(opt);
    });

    if (selectedCameraId) cSelect.value = selectedCameraId;
    if (selectedMicId) mSelect.value = selectedMicId;
}

async function applyMicSource(deviceId) {
    if (!deviceId || deviceId === selectedMicId) return;
    selectedMicId = deviceId;

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraint(), video: false });
        const audioTrack = newStream.getAudioTracks()[0];
        if (!audioTrack) return;

        audioTrack.enabled = document.getElementById('mic-switch').checked;
        const videoTracks = mediaStream ? mediaStream.getVideoTracks() : [];
        if (mediaStream) {
            mediaStream.getAudioTracks().forEach(t => t.stop());
        }
        mediaStream = new MediaStream([...videoTracks, audioTrack]);
        if (audioContext) {
            audioContext.close().catch(() => {});
            audioContext = null;
        }
        initAudioVisualizer(mediaStream);
    } catch (e) {
        console.error('Failed to switch microphone source:', e);
    }
}

async function applyCameraSource(deviceId) {
    if (!deviceId || deviceId === selectedCameraId) return;
    selectedCameraId = deviceId;

    const camSwitch = document.getElementById('cam-switch');
    if (!camSwitch.checked) return;

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: selectedCameraId } },
            audio: false
        });
        const newTrack = newStream.getVideoTracks()[0];
        if (!newTrack) return;

        const audioTracks = mediaStream ? mediaStream.getAudioTracks() : [];
        if (mediaStream) {
            mediaStream.getVideoTracks().forEach(t => t.stop());
        }
        mediaStream = new MediaStream([newTrack, ...audioTracks]);

        document.getElementById('dash-cam').srcObject = mediaStream;
        const sessionCam = document.getElementById('session-cam');
        if (sessionCam) sessionCam.srcObject = mediaStream;
        updateCamStatus(true);
    } catch (e) {
        console.error("Failed to switch camera source:", e);
    }
}
// --- SESSION LOGIC ---
const TIPS = [
    "Sit straight and keep shoulders relaxed 🪑",
    "Keep your face centered in the frame 🎯",
    "Drink some water before starting 💧",
    "Speak clearly, no rush 🙂",
    "Maintain eye contact with the camera 👀"
];
let tipIndex = 0;

document.getElementById('btn-start').onclick = startSessionPrep;

function startSessionPrep() {
    ipcRenderer.send('enter-fullscreen');
    document.getElementById('session-loader').style.display = 'flex';

    tipInterval = setInterval(() => {
        document.getElementById('loader-text').innerText = TIPS[tipIndex];
        tipIndex = (tipIndex + 1) % TIPS.length;
    }, 2500);
}

document.getElementById('ready-check').onchange = (e) => {
    document.getElementById('btn-confirm-start').disabled = !e.target.checked;
};

document.getElementById('btn-confirm-start').onclick = () => {
    clearInterval(tipInterval);
    document.getElementById('session-loader').style.display = 'none';
    startInterviewSession();
};

async function startInterviewSession() {
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('session-view').style.display = 'flex';

    const diffRange = document.getElementById('diff-range');
    const diffLabels = ["Beginner", "Intermediate", "Expert"];
    const difficulty = diffLabels[(diffRange ? parseInt(diffRange.value) : 2) - 1];

    let userData = {};
    try {
        userData = await ipcRenderer.invoke('get-user-profile');
    } catch (e) {
        console.error('Failed to read login profile:', e);
    }

    ipcRenderer.send('ai-send', JSON.stringify({
        type: "START_LISTENING",
        topics: selected,
        difficulty: difficulty,
        user: (userData.name || "Candidate")
    }));
    console.log("Session started | Topics:", selected, "| Difficulty:", difficulty);

    document.getElementById('session-cam').srcObject = mediaStream;

    // Set up smart auto-scroll on transcript box
    autoScrollEnabled = true;
    const transcriptBox = document.getElementById('transcript-box');
    if (transcriptBox) {
        transcriptBox.onscroll = () => {
            const nearBottom = transcriptBox.scrollHeight - transcriptBox.scrollTop - transcriptBox.clientHeight < 80;
            autoScrollEnabled = nearBottom;
        };
    }

    // Wire up code editor textarea — Tab indent, Ctrl+Enter submit, live line numbers
    const codeInput = document.getElementById('code-input');
    if (codeInput) {
        codeInput.addEventListener('keydown', (e) => {
            // Tab → insert 4 spaces
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = codeInput.selectionStart;
                const end   = codeInput.selectionEnd;
                codeInput.value = codeInput.value.substring(0, start) + '    ' + codeInput.value.substring(end);
                codeInput.selectionStart = codeInput.selectionEnd = start + 4;
                updateLineNumbers();
            }
            // Ctrl+Enter → submit
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitCode();
            }
        });
        codeInput.addEventListener('input', updateLineNumbers);
        codeInput.addEventListener('scroll', () => {
            const nums = document.getElementById('code-line-nums');
            if (nums) nums.scrollTop = codeInput.scrollTop;
        });
    }

    // Reset code editor state
    hideCodeEditor();

    // Cheat detection
    sessionActive = true;
    cheatWarningCount = 0;
    lastFaceAlertTime = 0;
    focusEvents = [];
    dismissCheatWarning();
    startFaceDetection();

    // Start timer
    sessionSeconds = 0;
    sessionPaused = false;
    updateTimerDisplay();
    sessionTimerInterval = setInterval(() => {
        if (!sessionPaused) {
            sessionSeconds++;
            updateTimerDisplay();
        }
    }, 1000);
}

function formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0)
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateTimerDisplay() {
    const el = document.getElementById('session-timer');
    if (el) el.textContent = formatTime(sessionSeconds);
}

function pauseSession() {
    const btn = document.getElementById('btn-pause');
    const statusEl = document.getElementById('session-status');
    sessionPaused = !sessionPaused;

    if (sessionPaused) {
        btn.textContent = '▶ Resume';
        btn.classList.add('is-paused');
        if (statusEl) { statusEl.textContent = '⏸ PAUSED'; statusEl.classList.add('paused'); }
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        ipcRenderer.send('ai-send', JSON.stringify({ type: "PAUSE_LISTENING" }));
    } else {
        btn.textContent = '⏸ Pause';
        btn.classList.remove('is-paused');
        if (statusEl) { statusEl.textContent = '⬤ LIVE'; statusEl.classList.remove('paused'); }
        ipcRenderer.send('ai-send', JSON.stringify({ type: "RESUME_LISTENING" }));
    }
}

function endSession() {
    // Pause the timer while confirming
    const wasPaused = sessionPaused;
    sessionPaused = true;
    const modal = document.getElementById('end-confirm-modal');
    modal.style.display = 'flex';
    // Store whether we were paused so we can restore on cancel
    modal.dataset.wasPaused = wasPaused;
}

function cancelEndSession() {
    const modal = document.getElementById('end-confirm-modal');
    const wasPaused = modal.dataset.wasPaused === 'true';
    sessionPaused = wasPaused;
    modal.style.display = 'none';
    // Restore pause button state if needed
    if (!wasPaused && document.getElementById('btn-pause').classList.contains('is-paused')) {
        // was live before confirm opened → resume
        sessionPaused = false;
    }
}

function confirmEndSession() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    sessionActive = false;
    stopFaceDetection();
    dismissCheatWarning();
    document.getElementById('end-confirm-modal').style.display = 'none';
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;

    ipcRenderer.send('ai-send', JSON.stringify({
        type: "STOP_LISTENING",
        cheat_warnings: cheatWarningCount,
        focus_events: focusEvents
    }));
    ipcRenderer.send('exit-fullscreen');

    document.getElementById('session-controls').style.display = 'none';
    addAIMessage("⏳ Generating your report... please wait.");
}

// --- AI & TRANSCRIPT HANDLING ---

// Scrolls transcript-box to the bottom only when auto-scroll is active
function scrollToBottom() {
    if (!autoScrollEnabled) return;
    const box = document.getElementById("transcript-box");
    if (box) box.scrollTop = box.scrollHeight;
}

// Helper to create AI Bubbles
// isCodeQuestion = true adds the yellow code-question CSS class
function addAIMessage(text, isCodeQuestion = false) {
    const box = document.getElementById("transcript-box");
    const div = document.createElement("div");
    div.className = isCodeQuestion ? "chat-bubble ai code-question" : "chat-bubble ai";
    div.innerText = text;
    box.appendChild(div);
    scrollToBottom();
}

// Helper for User Live Speech
function addPartial(text) {
    if (!liveBubble) {
        liveBubble = document.createElement("div");
        liveBubble.className = "chat-bubble user";
        document.getElementById("transcript-box").appendChild(liveBubble);
    }
    liveBubble.innerText = text;
    scrollToBottom();
}

function addFinal(text) {
    if (liveBubble) {
        liveBubble.innerText = text;
        liveBubble = null;
    } else {
        const div = document.createElement("div");
        div.className = "chat-bubble user";
        div.innerText = text;
        document.getElementById("transcript-box").appendChild(div);
    }
    scrollToBottom();
}

// UNIFIED IPC LISTENER
ipcRenderer.on('ai-message', (_, msg) => {
    try {
        const data = JSON.parse(msg);

        switch (data.type) {
            case "ENGINE_STATUS":
                console.log("AI Engine:", data.status);
                if (data.status === 'READY') {
                    // Engine confirmed running — hide any previous error toast
                    const t = document.getElementById('engine-toast');
                    if (t) t.style.display = 'none';
                }
                break;

            case "TOPICS":
                // If Python sends topics, merge into our list and re-render
                if (data.topics && data.topics.length) {
                    data.topics.forEach(t => { if (!TOPICS.includes(t)) TOPICS.push(t); });
                }
                renderTopicList();
                break;

            case "QUESTION":
                // If the previous code editor is still open (e.g. AI continued), close it
                if (awaitingCode) hideCodeEditor();

                if (isCodeQuestion(data.text)) {
                    // Add AI bubble with the special code-question style
                    addAIMessage(data.text, true);
                    speakQuestion(data.text);
                    // Let bubble animate in, then open the editor
                    setTimeout(showCodeEditor, 350);
                } else {
                    addAIMessage(data.text);
                    speakQuestion(data.text);
                }
                break;

            case "TRANSCRIPT_PARTIAL":
                addPartial(data.text);
                break;

            case "TRANSCRIPT_FINAL":
                addFinal(data.text);
                break;

            case "GENERATING_REPORT":
                addAIMessage("✅ Session ended. Generating your report, please wait...");
                break;

            case "REPORT_READY":
                addAIMessage("📄 Report ready! Opening PDF...");
                shell.openPath(data.path);
                setTimeout(() => location.reload(), 3000);
                break;

            case "NO_REPORT":
                addAIMessage("Session ended. No answers were recorded to generate a report.");
                setTimeout(() => location.reload(), 3000);
                break;

            case "ERROR":
                addAIMessage("⚠️ Error: " + data.msg);
                showEngineError(data.msg);
                break;
        }
    } catch (e) {
        console.error("Invalid AI message:", msg, e);
    }
});

