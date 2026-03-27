; build/installer.nsh — Custom NSIS hooks for AI Mock Interview Assistant
; Used by electron-builder to inject extra installer/uninstaller logic.

; ── Runs after files are copied (fresh install) ──────────────────────────────
; Delete any saved API key so the user is always prompted after a fresh install.
!macro customInstall
  Delete "$APPDATA\AI Mock Interview Assistant\config.json"
!macroend

; ── Runs during uninstall ────────────────────────────────────────────────────
; Remove the entire AppData folder: config, user profile, cached data, etc.
!macro customUnInstall
  RMDir /r "$APPDATA\AI Mock Interview Assistant"
!macroend
