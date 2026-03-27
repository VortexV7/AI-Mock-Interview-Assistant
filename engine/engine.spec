# engine.spec — PyInstaller spec for AI Mock Interview Assistant engine
# Run from the engine/ directory:  pyinstaller engine.spec --clean --noconfirm

import os
import glob
from PyInstaller.utils.hooks import collect_all, collect_data_files

block_cipher = None

# ── collect_all(pkg) returns (datas, binaries, hiddenimports) ─────────────────
def _ca(pkg):
    try:
        return collect_all(pkg)
    except Exception:
        return [], [], []

groq_d,        groq_b,        groq_h        = _ca('groq')
httpx_d,       httpx_b,       httpx_h       = _ca('httpx')
httpcore_d,    httpcore_b,    httpcore_h    = _ca('httpcore')
certifi_d,     certifi_b,     certifi_h     = _ca('certifi')
anyio_d,       anyio_b,       anyio_h       = _ca('anyio')
sniffio_d,     sniffio_b,     sniffio_h     = _ca('sniffio')
h11_d,         h11_b,         h11_h         = _ca('h11')
charset_d,     charset_b,     charset_h     = _ca('charset_normalizer')
idna_d,        idna_b,        idna_h        = _ca('idna')
pydantic_d,    pydantic_b,    pydantic_h    = _ca('pydantic')
pydcore_d,     pydcore_b,     pydcore_h     = _ca('pydantic_core')
reportlab_d,   reportlab_b,   reportlab_h   = _ca('reportlab')
sd_d,          sd_b,          sd_h          = _ca('sounddevice')
dotenv_d,      dotenv_b,      dotenv_h      = _ca('dotenv')

# ── PortAudio DLLs ────────────────────────────────────────────────────────────
# sounddevice is a flat module (sounddevice.py), NOT a package.
# It does:  import _sounddevice_data; path = next(iter(_sounddevice_data.__path__))
# So _sounddevice_data must land at _MEIPASS/_sounddevice_data/ (root of _internal).
# That is exactly where collect_all('sounddevice') puts it already.
# We force-add the DLLs separately to make sure they are included.
import os as _os, glob as _glob
_here   = _os.path.dirname(_os.path.abspath(SPEC))  # engine/ dir
_venv   = _os.path.join(_here, '..', '.venv', 'Lib', 'site-packages')
_pa_dir = _os.path.join(_venv, '_sounddevice_data', 'portaudio-binaries')
_pa_dlls = (_glob.glob(_os.path.join(_pa_dir, '*.dll'))
          + _glob.glob(_os.path.join(_pa_dir, '*.so*'))
          + _glob.glob(_os.path.join(_pa_dir, '*.dylib')))
# Destination: _sounddevice_data/portaudio-binaries  (root of _internal)
portaudio_datas = [(_dll, '_sounddevice_data/portaudio-binaries') for _dll in _pa_dlls]

all_datas = (groq_d + httpx_d + httpcore_d + certifi_d + anyio_d + sniffio_d
           + h11_d + charset_d + idna_d + pydantic_d + pydcore_d + reportlab_d
           + sd_d + portaudio_datas + dotenv_d)

all_binaries = (groq_b + httpx_b + httpcore_b + certifi_b + anyio_b + sniffio_b
              + h11_b + charset_b + idna_b + pydantic_b + pydcore_b + reportlab_b
              + sd_b + dotenv_b)

all_hidden = list(set(
    groq_h + httpx_h + httpcore_h + certifi_h + anyio_h + sniffio_h
    + h11_h + charset_h + idna_h + pydantic_h + pydcore_h + reportlab_h
    + sd_h + dotenv_h
    + ['ssl', 'wave', 'io', 'json', 'threading', 'queue',
       '_sounddevice', '_sounddevice_data',
       'numpy', 'numpy.core', 'numpy.core._multiarray_umath']
))

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=all_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['runtime_hook_ssl.py'],
    excludes=['tkinter', 'matplotlib', 'scipy', 'PIL', 'cv2'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='engine',
)
