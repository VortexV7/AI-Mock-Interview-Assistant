# runtime_hook_ssl.py — injected by PyInstaller at frozen startup, before app.py runs.

import os
import sys

if getattr(sys, 'frozen', False):
    _base = sys._MEIPASS

    # ── Fix 1: SSL cert bundle ────────────────────────────────────────────────
    # httpx calls certifi.where() at import-time to set DEFAULT_CA_BUNDLE_PATH.
    # In a frozen app the returned path may not exist — patch it before httpx loads.
    _ca = os.path.join(_base, 'certifi', 'cacert.pem')
    if os.path.isfile(_ca):
        os.environ['SSL_CERT_FILE']      = _ca
        os.environ['REQUESTS_CA_BUNDLE'] = _ca
        os.environ['CURL_CA_BUNDLE']     = _ca
        try:
            import certifi as _c
            _c.where = lambda: _ca
            try:
                import certifi.core as _cc
                _cc.where = lambda: _ca
            except Exception:
                pass
        except Exception:
            pass

    # ── Fix 2: PortAudio DLL search path ─────────────────────────────────────
    # sounddevice resolves PortAudio relative to its own __file__, so the DLL
    # must be reachable from Python DLL loading (add_dll_directory) AND PATH.
    # Check both the sounddevice-subdir form and the root form.
    for _pa_rel in (
        os.path.join('sounddevice', '_sounddevice_data', 'portaudio-binaries'),
        os.path.join('_sounddevice_data', 'portaudio-binaries'),
    ):
        _pa = os.path.join(_base, _pa_rel)
        if os.path.isdir(_pa):
            if hasattr(os, 'add_dll_directory'):
                try:
                    os.add_dll_directory(os.path.abspath(_pa))
                except OSError:
                    pass
            os.environ['PATH'] = os.path.abspath(_pa) + os.pathsep + os.environ.get('PATH', '')

