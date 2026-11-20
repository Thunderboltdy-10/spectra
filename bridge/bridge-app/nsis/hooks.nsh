; Spectra for desktop installer hooks (docs/desktop/PLAN.md).
;
; %LOCALAPPDATA%\Spectra already holds people's own data (the works kept on this
; computer and the agent relay token), so the program never installs there. A
; fresh per-user install goes to %LOCALAPPDATA%\Programs\Spectra, the Windows
; place for per-user apps; later updates find that folder in the registry.
!macro NSIS_HOOK_PREINSTALL
  ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCTNAME}"
    CreateDirectory "$INSTDIR"
    SetOutPath "$INSTDIR"
  ${EndIf}
!macroend

; Uninstalling (not updating) also removes the logon task the app made for
; itself, so nothing tries to start a program that is gone.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    nsExec::Exec 'schtasks.exe /Delete /TN "Spectra" /F'
    Pop $0
    nsExec::Exec 'schtasks.exe /Delete /TN "Spectra Bridge" /F'
    Pop $0
  ${EndIf}
!macroend
