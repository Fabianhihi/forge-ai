; FORGE AI – Windows-Installer
; Installiert ohne Admin-Rechte, legt Verknüpfungen an und startet die App sofort.
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ManifestDPIAware true
RequestExecutionLevel user

!define APPNAME "FORGE AI"
!define APPEXE "FORGE AI.exe"
!define VERSION "1.3.0"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\FORGE AI"
!ifndef SRCDIR
  !define SRCDIR "FORGE AI"
!endif
!ifndef OUTFILE
  !define OUTFILE "FORGE-AI-Setup.exe"
!endif

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
BrandingText "${APPNAME} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow
AutoCloseWindow true

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT"

!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_INSTFILESPAGE_COLORS "FFFFFF 0A0B0F"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"

Function .onInit
  ; Läuft die App noch? Dann schließen, damit sie aktualisiert werden kann.
  nsExec::Exec 'taskkill /F /IM "${APPEXE}"'
  Pop $0
FunctionEnd

Section "Install"
  SetDetailsPrint textonly
  DetailPrint "${APPNAME} wird installiert …"
  SetDetailsPrint none
  Sleep 400
  ; Alte Programmdateien entfernen (deine Chats und Modelle bleiben erhalten)
  RMDir /r "$INSTDIR\resources"
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\Deinstallieren.exe"

  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPEXE}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${APPEXE}"

  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Deinstallieren.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" 500000
  SetDetailsPrint textonly
  DetailPrint "Fertig! ${APPNAME} startet …"
SectionEnd

Function .onInstSuccess
  ; App direkt starten – ab hier läuft alles automatisch
  Exec '"$INSTDIR\${APPEXE}"'
FunctionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${APPEXE}"'
  Pop $0
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  MessageBox MB_YESNO|MB_ICONQUESTION "Sollen auch deine heruntergeladenen KI-Modelle und Chats gelöscht werden?$\n$\n(Nein = behalten, z. B. für eine spätere Neuinstallation)" IDNO keep
    RMDir /r "$APPDATA\${APPNAME}"
  keep:
SectionEnd
