import sys
import os
import json
import threading
import time
import datetime
import wave
import io

# ── Crash log (frozen build only) ────────────────────────────────────────────
# Installed BEFORE risky imports so even an import crash is captured.
_AI_CONFIG_DIR_EARLY = os.environ.get("AI_CONFIG_DIR", "")
if _AI_CONFIG_DIR_EARLY and getattr(sys, 'frozen', False):
    _CRASH_LOG = os.path.join(_AI_CONFIG_DIR_EARLY, "engine-crash.log")
    try:            # wipe stale log from previous run
        if os.path.exists(_CRASH_LOG):
            os.remove(_CRASH_LOG)
    except Exception:
        pass
    def _crash_hook(etype, evalue, etb):
        import traceback
        try:
            os.makedirs(_AI_CONFIG_DIR_EARLY, exist_ok=True)
            with open(_CRASH_LOG, 'w') as _cf:
                traceback.print_exception(etype, evalue, etb, file=_cf)
        except Exception:
            pass
        try:
            print(json.dumps({"type": "ERROR",
                               "msg": f"Fatal crash: {etype.__name__}: {evalue}"}),
                  flush=True)
        except Exception:
            pass
    sys.excepthook = _crash_hook

import numpy as np

# ── sounddevice — graceful: engine stays alive even if PortAudio DLL missing ──
try:
    import sounddevice as sd
    _SD_OK = True;  _SD_ERR = ""
except Exception as _e:
    _SD_OK = False; _SD_ERR = str(_e); sd = None

# ── python-dotenv — only used in dev mode; stub if missing in bundle ──────────
try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*a, **kw): pass

# ── Groq SDK — graceful: shows error on first use rather than crashing ─────────
try:
    from groq import Groq
    _GROQ_OK = True;  _GROQ_ERR = ""
except Exception as _e:
    _GROQ_OK = False; _GROQ_ERR = str(_e); Groq = None

# ---------- API KEY LOADING ----------
# In production: Electron passes AI_CONFIG_DIR (AppData path) → key stored there
# In development: load from .env file in project root
_config_dir = os.environ.get("AI_CONFIG_DIR", "")
if _config_dir:
    _config_path = os.path.join(_config_dir, "config.json")
    if os.path.exists(_config_path):
        try:
            with open(_config_path, "r") as _f:
                _cfg = json.load(_f)
                _key = _cfg.get("groq_api_key", "")
                if _key:
                    os.environ["GROQ_API_KEY"] = _key
        except Exception:
            pass
else:
    # Dev mode: fall back to .env in project root
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle

# ---------- CONFIG ----------
BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
REPORTS_DIR    = os.path.join(BASE_DIR, "reports")
GROQ_LLM_MODEL = "llama-3.3-70b-versatile"   # free on Groq, ~3× faster than local
SAMPLE_RATE    = 16000
CHUNK_SECONDS  = 5        # collect this many seconds of audio before transcribing
SILENCE_THRESH = 300      # RMS below this = silence
SILENCE_CHUNKS = 3        # consecutive silent chunks before flushing
FOLLOWUP_DELAY = 7.0

# ---------- STATE ----------
audio_buffer   = []
silent_count   = 0
listening_active = False
session_active = False   # guards LLM threads from sending after session ends
session_topics = []
session_difficulty  = "Intermediate"
session_user        = "Candidate"
conversation_history = []
qa_pairs        = []
current_question = None
answer_buffer   = []
followup_timer  = None
current_filler_count = 0
session_cheat_warnings = 0
session_focus_events   = []
llm_lock        = threading.Lock()   # serialise concurrent Groq LLM calls
GROQ_API_KEY    = os.environ.get("GROQ_API_KEY", "")
groq_client     = (Groq(api_key=GROQ_API_KEY) if (GROQ_API_KEY and _GROQ_OK) else None)

# ---------- HELPERS ----------
def send(data):
    print(json.dumps(data), flush=True)

# ---------- GROQ LLM ----------
def ask_llm(system_prompt, user_prompt, max_tokens=512):
    if not groq_client:
        send({"type": "ERROR", "msg": "Groq API key not set. Cannot generate questions."})
        return None
    try:
        response = groq_client.chat.completions.create(
            model=GROQ_LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt}
            ],
            max_tokens=max_tokens,
            temperature=0.7
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        send({"type": "ERROR", "msg": f"LLM error: {str(e)}"})
        return None

def build_system_prompt():
    topics_str = ", ".join(session_topics) if session_topics else "General"
    return (
        f"You are a professional technical interviewer conducting a mock interview.\n"
        f"Topics: {topics_str}\n"
        f"Difficulty: {session_difficulty}\n"
        f"Ask ONE concise interview question at a time. Be direct. No preamble. Just the question."
    )

def generate_first_question():
    global current_question
    with llm_lock:
        if not session_active:
            return
        question = ask_llm(build_system_prompt(), "Begin the interview. Ask your first question.")
        if question and session_active:
            current_question = question
            conversation_history.append({"role": "interviewer", "text": question})
            send({"type": "QUESTION", "text": question})

def generate_followup(user_answer, filler_count=0):
    global current_question
    with llm_lock:
        if not session_active:
            return
        if current_question:
            qa_pairs.append({"question": current_question, "answer": user_answer,
                             "filler_count": filler_count})
        history_text = ""
        for turn in conversation_history[-6:]:
            role = "Interviewer" if turn["role"] == "interviewer" else "Candidate"
            history_text += f"{role}: {turn['text']}\n"
        user_prompt = (
            f"Interview so far:\n{history_text}\n"
            f"Candidate just said: {user_answer}\n\n"
            f"Ask ONE follow-up or new question based on this."
        )
        question = ask_llm(build_system_prompt(), user_prompt)
        if question and session_active:
            current_question = question
            conversation_history.append({"role": "candidate", "text": user_answer})
            conversation_history.append({"role": "interviewer", "text": question})
            send({"type": "QUESTION", "text": question})

# ---------- REPORT GENERATION ----------
def generate_report():
    os.makedirs(REPORTS_DIR, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    pdf_path = os.path.join(REPORTS_DIR, f"interview_report_{timestamp}.pdf")

    topics_str = ", ".join(session_topics) if session_topics else "General"

    # Build per-QA text including filler count
    qa_text = ""
    for i, qa in enumerate(qa_pairs):
        fillers = qa.get("filler_count", 0)
        filler_note = f" [filler words used: {fillers}]" if fillers else ""
        qa_text += f"Q{i+1}: {qa['question']}\nA{i+1}: {qa['answer']}{filler_note}\n\n"

    focus_note = ""
    if session_cheat_warnings:
        focus_note = (f"\nBehavioral flags: {session_cheat_warnings} focus warning(s) were triggered "
                      f"during the session (tab switches, face not detected, window blur).\n")

    prompt = (
        f"You evaluated a candidate on: {topics_str}. Difficulty: {session_difficulty}.\n"
        f"{focus_note}\n"
        f"Here are all their answers:\n{qa_text}\n"
        f"For EACH answer output exactly these lines (replace N with the question number):\n"
        f"SCORE_N: <integer 1-10>\n"
        f"FEEDBACK_N: <one concise sentence>\n"
        f"IMPROVE_N: <one short tip>\n\n"
        f"Then output:\n"
        f"OVERALL: <integer 1-10>\n"
        f"SUMMARY: <two sentences overall assessment>\n"
        f"NEXT_STEPS: <three semicolon-separated short action items for improvement>"
    )

    with llm_lock:
        result = ask_llm(
            "You are a strict but fair interview evaluator. Be concise and constructive.",
            prompt,
            max_tokens=700
        )

    # Parse result
    evaluations = [{"score": 5, "feedback": "Good attempt.", "improve": "Keep practicing."} for _ in qa_pairs]
    overall_rating, overall_summary, next_steps = 5, "Interview completed.", []

    if result:
        for line in result.splitlines():
            line = line.strip()
            for i in range(len(qa_pairs)):
                n = i + 1
                if line.startswith(f"SCORE_{n}:"):
                    try: evaluations[i]["score"] = max(1, min(10,
                             int(''.join(filter(str.isdigit, line.split(":",1)[1][:3])))))
                    except: pass
                elif line.startswith(f"FEEDBACK_{n}:"):
                    evaluations[i]["feedback"] = line.split(":",1)[1].strip()
                elif line.startswith(f"IMPROVE_{n}:"):
                    evaluations[i]["improve"] = line.split(":",1)[1].strip()
            if line.startswith("OVERALL:"):
                try: overall_rating = max(1, min(10,
                         int(''.join(filter(str.isdigit, line.split(":",1)[1][:3])))))
                except: pass
            elif line.startswith("SUMMARY:"):
                overall_summary = line.split(":",1)[1].strip()
            elif line.startswith("NEXT_STEPS:"):
                raw = line.split(":",1)[1].strip()
                next_steps = [s.strip() for s in raw.split(";") if s.strip()]

    _build_pdf(pdf_path, evaluations, overall_rating, overall_summary, next_steps,
               session_cheat_warnings, session_focus_events)
    send({"type": "REPORT_READY", "path": pdf_path})

def _build_pdf(path, evaluations, overall_rating, overall_summary, next_steps,
               cheat_warnings=0, focus_events=None):
    if focus_events is None:
        focus_events = []

    topics_str = ", ".join(session_topics) if session_topics else "General"
    date_str   = datetime.datetime.now().strftime("%B %d, %Y  %H:%M")

    # ---- colour palette (matches app UI) ----
    NAVY   = colors.HexColor("#202124")
    BLUE   = colors.HexColor("#1A73E8")
    GREEN  = colors.HexColor("#34A853")
    RED    = colors.HexColor("#EA4335")
    AMBER  = colors.HexColor("#FBBC04")
    LGRAY  = colors.HexColor("#F8F9FA")
    MGRAY  = colors.HexColor("#E8EAED")
    DGRAY  = colors.HexColor("#5F6368")
    WHITE  = colors.white

    # ---- styles ----
    reg = ParagraphStyle("reg",  fontName="Helvetica",        fontSize=10, leading=15, textColor=NAVY, spaceAfter=4)
    bold= ParagraphStyle("bold", fontName="Helvetica-Bold",   fontSize=10, leading=15, textColor=NAVY, spaceAfter=4)
    sm  = ParagraphStyle("sm",   fontName="Helvetica",        fontSize=9,  leading=13, textColor=DGRAY)
    h2  = ParagraphStyle("h2",   fontName="Helvetica-Bold",   fontSize=13, leading=18, textColor=NAVY,
                          spaceBefore=14, spaceAfter=6, borderPadding=(0,0,4,0))
    tip = ParagraphStyle("tip",  fontName="Helvetica-Oblique",fontSize=9,  leading=13,
                          textColor=colors.HexColor("#B06000"), spaceAfter=5)
    white_reg = ParagraphStyle("wreg", fontName="Helvetica", fontSize=10, leading=14, textColor=WHITE)
    white_sm  = ParagraphStyle("wsm",  fontName="Helvetica", fontSize=8,  leading=12, textColor=colors.HexColor("#BDC1C6"))

    PAGE_W, PAGE_H = A4
    INNER_W = PAGE_W - 4*cm   # content width inside margins

    # ---- header / footer callbacks ----
    def on_page(canvas, doc):
        # Metadata (set once — repeated calls are harmless)
        canvas.setTitle("AI Mock Interview Report")
        canvas.setAuthor(session_user)
        canvas.setSubject(f"Mock Interview \u2013 {topics_str}")
        canvas.setCreator("AI Mock Interview Assistant v1.0 \u2013 groq.com")
        canvas.setKeywords(f"AI, mock interview, {session_difficulty}, {topics_str}")

        # Top colour bar
        canvas.setFillColor(NAVY)
        canvas.rect(0, PAGE_H - 1.1*cm, PAGE_W, 1.1*cm, fill=1, stroke=0)
        canvas.setFillColor(BLUE)
        canvas.rect(0, PAGE_H - 1.1*cm, 0.5*cm, 1.1*cm, fill=1, stroke=0)

        # Footer
        canvas.setFillColor(MGRAY)
        canvas.rect(0, 0, PAGE_W, 1*cm, fill=1, stroke=0)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(DGRAY)
        canvas.drawString(2*cm, 0.35*cm, "AI Mock Interview Assistant")
        canvas.drawRightString(PAGE_W - 2*cm, 0.35*cm,
                               f"Page {doc.page}  |  {date_str}")

    # ---- document ----
    doc = SimpleDocTemplate(
        path, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=1.8*cm, bottomMargin=1.5*cm
    )

    story = []

    # ===== COVER HEADER BLOCK =====
    header_tbl = Table([[
        [Paragraph("AI Mock Interview Report",
                   ParagraphStyle("ht", fontName="Helvetica-Bold", fontSize=20,
                                  textColor=WHITE, spaceAfter=4)),
         Paragraph(f"Candidate: {session_user}",
                   ParagraphStyle("hn", fontName="Helvetica", fontSize=11, textColor=WHITE)),
         Paragraph(f"{date_str}",
                   ParagraphStyle("hd", fontName="Helvetica", fontSize=9,
                                  textColor=colors.HexColor("#BDC1C6")))],
        Paragraph(f"<b>{overall_rating}</b><br/><font size='8'>OUT OF 10</font>",
                  ParagraphStyle("hr", fontName="Helvetica-Bold", fontSize=26,
                                 textColor=(GREEN if overall_rating >= 7 else
                                            AMBER  if overall_rating >= 5 else RED),
                                 alignment=1))
    ]], colWidths=[INNER_W - 3*cm, 3*cm])
    header_tbl.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), NAVY),
        ("PADDING",     (0,0), (-1,-1), 14),
        ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
        ("LINEBELOW",   (0,0), (-1,-1), 3, BLUE),
    ]))
    story.append(header_tbl)
    story.append(Spacer(1, 0.4*cm))

    # ===== SESSION INFO ROW =====
    total_fillers = sum(qa.get("filler_count", 0) for qa in qa_pairs)
    info_data = [
        [Paragraph("<b>Topics</b>", bold),    Paragraph(topics_str, reg)],
        [Paragraph("<b>Difficulty</b>", bold), Paragraph(session_difficulty, reg)],
        [Paragraph("<b>Questions</b>", bold),  Paragraph(str(len(qa_pairs)), reg)],
        [Paragraph("<b>Filler Words</b>", bold), Paragraph(str(total_fillers), reg)],
        [Paragraph("<b>Focus Warnings</b>", bold),
         Paragraph(str(cheat_warnings),
                   ParagraphStyle("fw", fontName="Helvetica", fontSize=10, leading=15,
                                  textColor=(RED if cheat_warnings >= 4 else
                                             AMBER if cheat_warnings >= 1 else GREEN)))],
    ]
    info_tbl = Table(info_data, colWidths=[4*cm, INNER_W - 4*cm])
    info_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), LGRAY),
        ("BACKGROUND", (0,0), (0,-1), MGRAY),
        ("GRID",       (0,0), (-1,-1), 0.5, MGRAY),
        ("PADDING",    (0,0), (-1,-1), 7),
        ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
    ]))
    story.append(info_tbl)
    story.append(Spacer(1, 0.3*cm))

    # ===== OVERALL SUMMARY =====
    story.append(Paragraph(overall_summary, reg))
    story.append(HRFlowable(width="100%", thickness=1, color=MGRAY, spaceAfter=6))

    # ===== QUESTION BREAKDOWN =====
    story.append(Paragraph("Question-by-Question Breakdown", h2))
    for i, (qa, ev) in enumerate(zip(qa_pairs, evaluations)):
        score = ev["score"]
        sc = GREEN if score >= 7 else (AMBER if score >= 5 else RED)
        fc = qa.get("filler_count", 0)

        # Score chip + question header
        q_tbl = Table([[
            Paragraph(f"<b>{score}/10</b>",
                      ParagraphStyle("chip", fontName="Helvetica-Bold", fontSize=11,
                                     textColor=WHITE, alignment=1)),
            Paragraph(f"<b>Q{i+1}.</b> {qa['question']}", bold)
        ]], colWidths=[1.2*cm, INNER_W - 1.2*cm])
        q_tbl.setStyle(TableStyle([
            ("BACKGROUND",  (0,0), (0,0), sc),
            ("BACKGROUND",  (1,0), (1,0), LGRAY),
            ("PADDING",     (0,0), (-1,-1), 8),
            ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
            ("LINEBELOW",   (0,0), (-1,-1), 1, MGRAY),
        ]))
        story.append(q_tbl)
        story.append(Paragraph(f"<i>Your answer:</i> {qa['answer'] or '(no answer recorded)'}",
                                ParagraphStyle("ans", fontName="Helvetica-Oblique", fontSize=9,
                                               leading=13, textColor=DGRAY,
                                               leftIndent=8, spaceAfter=3)))
        if fc:
            story.append(Paragraph(f"Filler words detected: {fc}  (um/uh/hmm etc.)",
                                    ParagraphStyle("fi", fontName="Helvetica", fontSize=8,
                                                   textColor=AMBER, leftIndent=8, spaceAfter=3)))
        story.append(Paragraph(f"\u2714 {ev['feedback']}", reg))
        story.append(Paragraph(f"\u26a1 Tip: {ev['improve']}", tip))
        story.append(Spacer(1, 0.2*cm))

    # ===== BEHAVIOURAL ANALYSIS =====
    if cheat_warnings or focus_events or total_fillers:
        story.append(HRFlowable(width="100%", thickness=1, color=MGRAY, spaceAfter=6))
        story.append(Paragraph("Behavioural Analysis", h2))

        if total_fillers:
            story.append(Paragraph(
                f"You used <b>{total_fillers}</b> filler word(s) across your answers. "
                "Practice pausing briefly instead of filling silence with 'um' or 'uh'.", reg))

        if cheat_warnings:
            story.append(Paragraph(
                f"The system triggered <b>{cheat_warnings}</b> focus warning(s) during your session "
                "(tab switches, camera not detecting a face, or window losing focus).", reg))

        if focus_events:
            story.append(Paragraph("Focus event log:", bold))
            ev_data = [["Time", "Event"]] + [[e.get("time","?"), e.get("desc","")] for e in focus_events]
            ev_tbl = Table(ev_data, colWidths=[2*cm, INNER_W - 2*cm])
            ev_tbl.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,0), NAVY),
                ("TEXTFONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
                ("TEXTCOLOR", (0,0), (-1,0), WHITE),
                ("BACKGROUND", (0,1), (-1,-1), LGRAY),
                ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LGRAY]),
                ("GRID",   (0,0), (-1,-1), 0.5, MGRAY),
                ("PADDING",(0,0), (-1,-1), 6),
                ("FONTSIZE",(0,0), (-1,-1), 9),
            ]))
            story.append(ev_tbl)

    # ===== NEXT STEPS =====
    if next_steps:
        story.append(HRFlowable(width="100%", thickness=1, color=MGRAY, spaceAfter=6))
        story.append(Paragraph("Recommended Next Steps", h2))
        for step in next_steps:
            story.append(Paragraph(f"\u25b6 {step}", reg))

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)

# Whisper hallucinates these phrases on silence/noise — filter them out
HALLUCINATIONS = {
    "thank you", "thanks", "thank you.", "thanks.", "thank you for watching",
    "thank you for watching.", "thanks for watching.", "bye", "bye.", "you",
    ".", " ", "...", "you.", "okay.", "okay",
}

# Filler words — kept in transcript but counted separately per answer
FILLER_WORDS = {"um", "uh", "hmm", "uhh", "umm", "hm", "er", "ah"}

def count_filler_words(text):
    words = text.lower().split()
    return sum(1 for w in words if w.strip('.,!?-') in FILLER_WORDS)

# ---------- GROQ WHISPER TRANSCRIPTION (free, fast, accurate) ----------
def transcribe_chunk(audio_np):
    if not groq_client:
        send({"type": "ERROR", "msg": "GROQ_API_KEY not set. Get a free key at console.groq.com"})
        return ""
    # Guard against truly empty / near-zero audio using peak amplitude
    peak = int(np.max(np.abs(audio_np.astype(np.int32))))
    if peak < 200:   # < ~0.6 % of int16 max  →  just DC noise, skip
        return ""
    try:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)       # int16 = 2 bytes
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio_np.astype(np.int16).tobytes())
        buf.seek(0)
        result = groq_client.audio.transcriptions.create(
            file=("audio.wav", buf, "audio/wav"),
            model="whisper-large-v3-turbo",
            language="en",
            response_format="text"
        )
        text = (result or "").strip()
        if text.lower() in HALLUCINATIONS:
            return ""
        return text
    except Exception as e:
        send({"type": "ERROR", "msg": f"STT error: {e}"})
        return ""

def audio_processor():
    global audio_buffer, silent_count
    had_speech = False   # True if any incremental chunk since last flush had speech
    prev_len   = 0       # length of chunk seen on last iteration
    while True:
        if not listening_active:
            time.sleep(0.05)
            # Reset state so first chunk after resume is evaluated fresh
            had_speech = False
            prev_len   = 0
            continue
        time.sleep(0.5)
        if not audio_buffer:
            continue
        local_copy = list(audio_buffer)   # snapshot the list references
        if not local_copy:
            continue
        chunk       = np.concatenate(local_copy)
        new_segment = chunk[prev_len:]    # only audio added since last check
        prev_len    = len(chunk)

        if len(new_segment) > 0:
            seg_rms = np.sqrt(np.mean(new_segment.astype(np.float32) ** 2))
            if seg_rms >= SILENCE_THRESH:
                had_speech   = True
                silent_count = 0
            else:
                silent_count += 1

        total_seconds = len(chunk) / SAMPLE_RATE
        should_flush  = (total_seconds >= CHUNK_SECONDS or
                         (silent_count >= SILENCE_CHUNKS and total_seconds > 1.0))
        if should_flush:
            audio_buffer.clear()
            send_chunk    = chunk
            do_transcribe = had_speech
            had_speech    = False
            prev_len      = 0
            silent_count  = 0
            if do_transcribe:
                threading.Thread(target=process_speech, args=(send_chunk,), daemon=True).start()

def process_speech(chunk):
    text = transcribe_chunk(chunk)
    if text:
        send({"type": "TRANSCRIPT_FINAL", "text": text})
        on_transcript_final(text)

# ---------- AUDIO CALLBACK ----------
def audio_callback(indata, frames, time_info, status):
    if listening_active:
        audio_buffer.append(np.frombuffer(indata, dtype=np.int16).copy())

# ---------- ANSWER ACCUMULATION ----------
def flush_answer():
    global answer_buffer, followup_timer, current_filler_count
    followup_timer = None
    if not answer_buffer:
        return
    full_answer = " ".join(answer_buffer)
    answer_buffer = []
    saved_filler_count = current_filler_count
    current_filler_count = 0
    threading.Thread(target=generate_followup,
                     args=(full_answer, saved_filler_count), daemon=True).start()

def on_transcript_final(text):
    global answer_buffer, followup_timer, current_filler_count
    current_filler_count += count_filler_words(text)
    answer_buffer.append(text)
    if followup_timer:
        followup_timer.cancel()
    followup_timer = threading.Timer(FOLLOWUP_DELAY, flush_answer)
    followup_timer.start()

# ---------- STDIN HANDLER ----------
def handle_command(data):
    global listening_active, session_active, session_topics, session_difficulty, session_user
    global conversation_history, qa_pairs, current_question, answer_buffer, followup_timer, silent_count

    msg_type = data.get("type")

    if msg_type == "GET_TOPICS":
        send({"type": "TOPICS", "topics": [
            "Python", "Java", "JavaScript", "C++", "C#",
            "Data Structures", "Algorithms", "System Design", "SQL",
            "HR Questions", "Behavioral", "Leadership", "Teamwork",
            "React", "Node.js", "Angular", "DevOps", "Machine Learning"
        ]})

    elif msg_type == "START_LISTENING":
        # Re-attempt API key load if groq_client is not yet ready
        global groq_client, GROQ_API_KEY
        if not groq_client:
            _dir = os.environ.get("AI_CONFIG_DIR", "")
            if _dir:
                _p = os.path.join(_dir, "config.json")
                if os.path.exists(_p):
                    try:
                        with open(_p, "r") as _f:
                            _k = json.load(_f).get("groq_api_key", "")
                        if _k and _GROQ_OK:
                            GROQ_API_KEY = _k
                            groq_client = Groq(api_key=GROQ_API_KEY)
                    except Exception:
                        pass
        if not groq_client:
            send({"type": "ERROR", "msg": "Groq API key not found. Please re-enter it in Settings."})

        session_topics     = data.get("topics", [])
        session_difficulty = data.get("difficulty", "Intermediate")
        session_user       = data.get("user", "Candidate")
        conversation_history.clear()
        qa_pairs.clear()
        current_question = None
        answer_buffer    = []
        audio_buffer.clear()
        silent_count = 0
        if followup_timer:
            followup_timer.cancel()
            followup_timer = None
        session_active = True
        listening_active = True
        send({"type": "ACK", "msg": "Session started"})
        threading.Thread(target=generate_first_question, daemon=True).start()

    elif msg_type == "PAUSE_LISTENING":
        listening_active = False

    elif msg_type == "RESUME_LISTENING":
        listening_active = True

    elif msg_type == "STOP_LISTENING":
        session_active   = False
        listening_active = False
        global session_cheat_warnings, session_focus_events
        session_cheat_warnings = data.get("cheat_warnings", 0)
        session_focus_events   = data.get("focus_events", [])
        if followup_timer:
            followup_timer.cancel()
            followup_timer = None
        if answer_buffer and current_question:
            qa_pairs.append({"question": current_question, "answer": " ".join(answer_buffer),
                             "filler_count": current_filler_count})
            answer_buffer.clear()
        send({"type": "ACK", "msg": "Session ended"})
        if qa_pairs:
            send({"type": "GENERATING_REPORT"})
            threading.Thread(target=generate_report, daemon=True).start()
        else:
            send({"type": "NO_REPORT", "msg": "No answers recorded"})

def stdin_reader():
    for line in sys.stdin:
        line = line.strip()
        if line:
            try:
                handle_command(json.loads(line))
            except json.JSONDecodeError:
                pass

# ---------- STARTUP ----------
send({"type": "ENGINE_STATUS", "status": "READY"})

# Report any import failures now that send() is available
if not _GROQ_OK:
    send({"type": "ERROR", "msg": f"Groq SDK failed to load ({_GROQ_ERR}). Please reinstall the app."})
if not _SD_OK:
    send({"type": "ERROR", "msg": f"Microphone driver failed to load ({_SD_ERR}). STT will be unavailable."})

if _SD_OK:
    try:
        stream = sd.RawInputStream(
            samplerate=SAMPLE_RATE,
            blocksize=8000,
            dtype="int16",
            channels=1,
            callback=audio_callback
        )
        stream.start()
    except Exception as e:
        send({"type": "ERROR", "msg": f"Microphone init failed: {e}"})
        stream = None
else:
    stream = None

threading.Thread(target=stdin_reader, daemon=True).start()
threading.Thread(target=audio_processor, daemon=True).start()

while True:
    time.sleep(1)
