Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!ifndef APP_VERSION
  !error "APP_VERSION is required"
!endif
!ifndef RESOURCE_VERSION
  !error "RESOURCE_VERSION is required"
!endif
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\adOmnia"
!define WEBVIEW_KEY "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

Name "adOmnia"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\adOmnia"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
BrandingText "adOmnia"
VIProductVersion "${RESOURCE_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "adOmnia Setup"
VIAddVersionKey /LANG=1033 "FileDescription" "adOmnia per-user installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Andrea Cavallo"
!define MUI_ICON "${REPO_DIR}\build\windows\icon.ico"
!define MUI_UNICON "${REPO_DIR}\build\windows\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Install adOmnia for your Windows account. Administrator access is not required.$\r$\n$\r$\nClose adOmnia before continuing. Workspaces, collections and settings are preserved.$\r$\n$\r$\nIf WebView2 is missing, Setup installs Microsoft's Evergreen runtime (requires internet)."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${REPO_DIR}\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\adomnia.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Italian"

Function .onInit
  SetShellVarContext current
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "adOmnia requires Windows 10 or later." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "This installer requires 64-bit Windows." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
FunctionEnd

Function DetectWebView
  SetRegView 32
  ReadRegStr $0 HKLM "${WEBVIEW_KEY}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "${WEBVIEW_KEY}" "pv"
  ${EndIf}
FunctionEnd

!macro EnsureClosed PREFIX
Function ${PREFIX}EnsureClosed
  IfFileExists "$INSTDIR\adomnia.exe" 0 closed
  retry:
  System::Call 'kernel32::CreateFileW(w "$INSTDIR\adomnia.exe", i 0xC0000000, i 0, p 0, i 3, i 0, p 0) p.r0'
  IntCmp $0 -1 locked unlocked unlocked
  locked:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Close adOmnia before continuing. Setup will not stop the application or discard your work." /SD IDCANCEL IDRETRY retry
    SetErrorLevel 3
    Abort
  unlocked:
    System::Call 'kernel32::CloseHandle(p r0)'
  closed:
FunctionEnd
!macroend
!insertmacro EnsureClosed ""
!insertmacro EnsureClosed "un."

Section "adOmnia (required)" MainSection
  SectionIn RO
  Call EnsureClosed
  Call DetectWebView
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=WebView2Setup.exe "${WEBVIEW_BOOTSTRAPPER}"
    DetailPrint "Installing Microsoft Edge WebView2 Runtime..."
    ExecWait '"$PLUGINSDIR\WebView2Setup.exe" /silent /install' $1
    Call DetectWebView
    ${If} $0 == ""
    ${OrIf} $0 == "0.0.0.0"
      MessageBox MB_OK|MB_ICONSTOP "WebView2 installation did not complete (code $1). Check your internet connection and run Setup again." /SD IDOK
      SetErrorLevel 2
      Abort
    ${EndIf}
  ${EndIf}
  SetOutPath "$INSTDIR"
  ClearErrors
  File /oname=.adomnia-setup-new.exe "${APP_EXE}"
  IfErrors install_failed
  IfFileExists "$INSTDIR\adomnia.exe" 0 replace
    Delete "$INSTDIR\.adomnia-setup-previous.exe"
    ClearErrors
    Rename "$INSTDIR\adomnia.exe" "$INSTDIR\.adomnia-setup-previous.exe"
    IfErrors install_failed
  replace:
    ClearErrors
    Rename "$INSTDIR\.adomnia-setup-new.exe" "$INSTDIR\adomnia.exe"
    IfErrors 0 installed
    Rename "$INSTDIR\.adomnia-setup-previous.exe" "$INSTDIR\adomnia.exe"
  install_failed:
    Delete "$INSTDIR\.adomnia-setup-new.exe"
    MessageBox MB_OK|MB_ICONSTOP "Could not install adOmnia. Close the application and run Setup again." /SD IDOK
    SetErrorLevel 3
    Abort
  installed:
  Delete "$INSTDIR\.adomnia-setup-previous.exe"
  File /oname=LICENSE.txt "${REPO_DIR}\LICENSE"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\adOmnia"
  CreateShortcut "$SMPROGRAMS\adOmnia\adOmnia.lnk" "$INSTDIR\adomnia.exe"
  CreateShortcut "$SMPROGRAMS\adOmnia\Uninstall adOmnia.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "adOmnia"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Andrea Cavallo"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\adomnia.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/Andrea-Cavallo/adOmnia"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${APP_SIZE_KB}
SectionEnd

Section /o "Desktop shortcut" DesktopSection
  CreateShortcut "$DESKTOP\adOmnia.lnk" "$INSTDIR\adomnia.exe"
SectionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

Section "Uninstall"
  SetRegView 32
  Call un.EnsureClosed
  ClearErrors
  Delete "$INSTDIR\adomnia.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Close adOmnia before uninstalling, then try again." /SD IDOK
    SetErrorLevel 3
    Abort
  ${EndIf}
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\.adomnia-setup-new.exe"
  Delete "$INSTDIR\.adomnia-setup-previous.exe"
  Delete "$INSTDIR\Uninstall.exe"
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    Delete "$SMPROGRAMS\adOmnia\adOmnia.lnk"
    Delete "$SMPROGRAMS\adOmnia\Uninstall adOmnia.lnk"
    RMDir "$SMPROGRAMS\adOmnia"
    Delete "$DESKTOP\adOmnia.lnk"
  ${EndIf}
  ; Never recurse: user files and application data are not installer-owned.
  RMDir "$INSTDIR"
SectionEnd
