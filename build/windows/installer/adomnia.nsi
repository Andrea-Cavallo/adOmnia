; adOmnia Windows installer (NSIS 3, Unicode).
;
; Per-user install: no administrator rights, no UAC prompt. The application goes to
; %LOCALAPPDATA%\Programs\adOmnia, the same folder scripts/install.ps1 uses, so the
; in-app updater can replace adomnia.exe in place without elevation.
;
; Build (from the repository root, after `wails3 task windows:build`):
;   makensis /DVERSION=1.2.3 /DVI_VERSION=1.2.3.0 build\windows\installer\adomnia.nsi
; Optional: /DAPP_EXE=<path to adomnia.exe> /DOUTFILE=<path to setup.exe>
;
; Silent install / upgrade: adomnia-setup.exe /S [/D=C:\path]   (/D must be last)
; Silent uninstall:        "%LOCALAPPDATA%\Programs\adOmnia\uninstall.exe" /S
;
; User data (%APPDATA%\adomnia: workspaces, collections, settings, vault) is never
; touched by an install or an upgrade. The uninstaller removes it only when the user
; explicitly ticks the option, and never in silent mode.

Unicode true
ManifestDPIAware true
ManifestSupportedOS all

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef VERSION
  !error "Pass the release version: makensis /DVERSION=1.2.3 ..."
!endif
!ifndef VI_VERSION
  !define VI_VERSION "0.0.0.0"
!endif
!ifndef APP_EXE
  !define APP_EXE "..\..\..\bin\adomnia.exe"
!endif
!ifndef OUTFILE
  !define OUTFILE "..\..\..\dist\adomnia-${VERSION}-windows-amd64-setup.exe"
!endif

!define APP_NAME "adOmnia"
!define APP_EXE_NAME "adomnia.exe"
!define PUBLISHER "Andrea Cavallo"
!define HOMEPAGE "https://github.com/Andrea-Cavallo/adOmnia"
!define RELEASES_PAGE "https://github.com/Andrea-Cavallo/adOmnia/releases"
; The updater reads this key to recognise an installed copy and keeps DisplayVersion current.
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\adOmnia"
; Staged copy the in-app updater may leave next to the executable after a failed swap.
!define UPDATER_STAGED ".adomnia.exe.update"
!define WEBVIEW2_CLIENT "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WEBVIEW2_DOWNLOAD "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\adOmnia"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${APP_NAME} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VI_VERSION}"
VIFileVersion "${VI_VERSION}"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${APP_NAME} ${VERSION} Setup"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "GNU GPL v3, ${PUBLISHER}"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install ${APP_NAME} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Local-first API and development toolbox.$\r$\n$\r$\n${APP_NAME} installs for your Windows account only: no administrator rights are needed, and updates install from inside the app.$\r$\n$\r$\nYour workspaces, collections and settings stay on this computer and are kept on upgrade."
!define MUI_COMPONENTSPAGE_NODESC
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE_NAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME}"
!define MUI_FINISHPAGE_LINK "Release notes"
!define MUI_FINISHPAGE_LINK_LOCATION "${RELEASES_PAGE}/tag/v${VERSION}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\..\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_COMPONENTS
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; Waits until adomnia.exe in $INSTDIR can be opened for writing, so an upgrade never
; half-replaces a running application. Silent runs fail instead of prompting.
!macro WaitForAppClosed UN
Function ${UN}WaitForAppClosed
  IfFileExists "$INSTDIR\${APP_EXE_NAME}" 0 done
  retry:
    ClearErrors
    FileOpen $0 "$INSTDIR\${APP_EXE_NAME}" a
    ${IfNot} ${Errors}
      FileClose $0
      Goto done
    ${EndIf}
    IfSilent 0 +3
      SetErrorLevel 2
      Quit
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APP_NAME} is still running.$\r$\n$\r$\nClose every ${APP_NAME} window, then click Retry." IDRETRY retry
    Quit
  done:
FunctionEnd
!macroend
!insertmacro WaitForAppClosed ""
!insertmacro WaitForAppClosed "un."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "${APP_NAME} requires 64-bit Windows 10 or later."
    SetErrorLevel 1
    Quit
  ${EndIf}
FunctionEnd

; WebView2 ships with Windows 11 and current Windows 10. Its absence is reported once,
; with a link to Microsoft's installer; adOmnia cannot start without it.
Function WarnMissingWebView2
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2_CLIENT}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\${WEBVIEW2_CLIENT}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    IfSilent done
    MessageBox MB_YESNO|MB_ICONINFORMATION "${APP_NAME} needs the Microsoft Edge WebView2 Runtime, which is not installed on this computer.$\r$\n$\r$\nOpen Microsoft's download page now?" IDNO done
    ExecShell "open" "${WEBVIEW2_DOWNLOAD}"
  ${EndIf}
  done:
FunctionEnd

Section "${APP_NAME}" SecApp
  SectionIn RO
  SetOutPath "$INSTDIR"
  Call WaitForAppClosed
  SetOverwrite on
  File "/oname=${APP_EXE_NAME}" "${APP_EXE}"
  Delete "$INSTDIR\${UPDATER_STAGED}"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE_NAME},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "${HOMEPAGE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLUpdateInfo" "${RELEASES_PAGE}"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"

  Call WarnMissingWebView2
SectionEnd

Section "Start menu shortcut" SecStartMenu
  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE_NAME}" "" "$INSTDIR\${APP_EXE_NAME}" 0
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE_NAME}" "" "$INSTDIR\${APP_EXE_NAME}" 0
SectionEnd

; ── Uninstaller ──────────────────────────────────────────────────────────────

Section "-un.${APP_NAME}"
  Call un.WaitForAppClosed
  Delete "$INSTDIR\${APP_EXE_NAME}"
  Delete "$INSTDIR\${UPDATER_STAGED}"
  Delete "$INSTDIR\uninstall.exe"
  ; Only an empty folder is removed: files the user put there stay.
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd

; Unticked by default, and never selected in a silent uninstall.
Section /o "un.Also delete my data (workspaces, collections, settings, vault)" SecUnData
  RMDir /r "$APPDATA\adomnia"
SectionEnd
