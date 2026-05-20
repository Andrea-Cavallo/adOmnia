# installer.md — Installer professionale adOmnia

Data: 2026-05-17

Obiettivo: produrre installer branded e professionali per Windows, macOS e Linux,
ciascuno con logo, wizard guidato (dove applicabile) e uninstaller.

Asset di riferimento già presenti:
- `build/appicon.png`       — icona principale (PNG)
- `build/windows/icon.ico`  — icona Windows già pronta
- `assets/images/adOmnia-noback.png` — logo senza sfondo per splash/background

---

## Prerequisiti comuni

- [ ] Verificare che il binary sia già ottimizzato (Steps 1+2 di `docs/size.md`).
- [ ] Decidere il numero di versione definitivo (es. `1.0.0`) e aggiornarlo in:
  - `wails.json` → campo `version` (se presente)
  - `build/windows/info.json`
  - i build script esistenti (`build.ps1`, `build.sh`)
- [ ] Creare la cartella `build/installer-assets/` con le risorse brandizzate:
  - [ ] `logo-installer.png` — 256×256, fondo bianco, per NSIS e Linux
  - [ ] `dmg-background.png` — 660×400 px, fondo dark con logo centrato, per macOS
  - [ ] `splash.bmp` — 164×314 px BMP 24-bit per wizard NSIS (opzionale ma professionale)
  - [ ] `license.txt` — testo licenza da mostrare nel wizard

---

## Windows — NSIS installer con branding

### A. Prerequisiti Windows

- [ ] Installare NSIS: https://nsis.sourceforge.io/Download (versione ≥ 3.09)
- [ ] Installare plugin NSIS **NsisMultiUser** (per install per-user o system-wide):
  ```
  # Copiare plugin in C:\Program Files (x86)\NSIS\Plugins\x86-unicode\
  ```
- [ ] Installare **EnVar plugin** per scrivere variabili d'ambiente:
  https://nsis.sourceforge.io/EnVar_plug-in

### B. Build del binary

- [ ] Eseguire il build ottimizzato:
  ```powershell
  wails build -platform windows/amd64 -ldflags "-s -w" -trimpath -nsis
  ```
  Wails genera automaticamente uno script NSIS base in `build/windows/installer/`.

### C. Personalizzare lo script NSIS

Il file generato da Wails è in `build/windows/installer/installer.nsi`.

- [ ] Aprire `installer.nsi` e personalizzare:
  ```nsis
  ; Branding
  Name "adOmnia"
  OutFile "dist\adOmnia-${VERSION}-windows-amd64-setup.exe"
  InstallDir "$PROGRAMFILES64\adOmnia"
  
  ; Icone e splash
  Icon "build\windows\icon.ico"
  UninstallIcon "build\windows\icon.ico"
  !define MUI_WELCOMEFINISHPAGE_BITMAP "build\installer-assets\splash.bmp"
  !define MUI_ICON "build\windows\icon.ico"
  !define MUI_UNICON "build\windows\icon.ico"
  !define MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_BITMAP "build\installer-assets\logo-installer.png"
  
  ; Pagine wizard
  !insertmacro MUI_PAGE_WELCOME
  !insertmacro MUI_PAGE_LICENSE "build\installer-assets\license.txt"
  !insertmacro MUI_PAGE_DIRECTORY
  !insertmacro MUI_PAGE_INSTFILES
  !insertmacro MUI_PAGE_FINISH
  !insertmacro MUI_UNPAGE_CONFIRM
  !insertmacro MUI_UNPAGE_INSTFILES
  ```
- [ ] Aggiungere shortcut sul Desktop:
  ```nsis
  CreateShortcut "$DESKTOP\adOmnia.lnk" "$INSTDIR\adOmnia.exe" "" "$INSTDIR\adOmnia.exe" 0
  ```
- [ ] Aggiungere shortcut in Start Menu:
  ```nsis
  CreateDirectory "$SMPROGRAMS\adOmnia"
  CreateShortcut "$SMPROGRAMS\adOmnia\adOmnia.lnk" "$INSTDIR\adOmnia.exe"
  CreateShortcut "$SMPROGRAMS\adOmnia\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  ```
- [ ] Registrare uninstaller in "Programmi e funzionalità":
  ```nsis
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\adOmnia" \
    "DisplayName" "adOmnia"
  WriteRegStr HKLM "..." "DisplayIcon" "$INSTDIR\adOmnia.exe"
  WriteRegStr HKLM "..." "Publisher" "adOmnia"
  WriteRegStr HKLM "..." "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "..." "UninstallString" "$INSTDIR\Uninstall.exe"
  ```

### D. Compilare l'installer

- [ ] Compilare con makensis:
  ```powershell
  & "C:\Program Files (x86)\NSIS\makensis.exe" build\windows\installer\installer.nsi
  ```
- [ ] Verificare che `dist\adOmnia-1.0.0-windows-amd64-setup.exe` venga prodotto.
- [ ] Eseguire l'installer su una macchina pulita (o VM) e verificare:
  - [ ] Wizard mostra logo/splash
  - [ ] Installazione in `Program Files\adOmnia`
  - [ ] Shortcut Desktop e Start Menu funzionanti
  - [ ] Uninstaller funzionante e rimuove le voci di registro
  - [ ] App si avvia correttamente dopo installazione

### E. Code signing (per distribuzione pubblica)

- [ ] Acquistare certificato Code Signing (OV o EV) da provider come Sectigo, DigiCert, Certum.
  - OV (~€100/anno): nessun blocco SmartScreen ma possibile warning iniziale
  - EV (~€300/anno): nessun warning SmartScreen da subito
- [ ] Firmare il binary prima di creare l'installer:
  ```powershell
  signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 `
    /a /n "Nome Azienda" build\bin\adOmnia.exe
  ```
- [ ] Firmare anche l'installer `.exe` con lo stesso comando.

---

## macOS — DMG con sfondo branded

### A. Prerequisiti macOS

Questi passi vanno eseguiti su una macchina macOS (non cross-compilabili da Windows).

- [ ] Installare Xcode Command Line Tools: `xcode-select --install`
- [ ] Installare `create-dmg`: `brew install create-dmg`
- [ ] (Per distribuzione pubblica) Iscriversi ad Apple Developer Program ($99/anno).

### B. Build universale

- [ ] Su macOS, eseguire:
  ```bash
  wails build -platform darwin/universal -ldflags "-s -w" -trimpath
  ```
  Produce `build/bin/adOmnia.app` (Intel + Apple Silicon).

### C. Icona macOS .icns

- [ ] Creare il file `.icns` dall'immagine PNG sorgente:
  ```bash
  mkdir adOmnia.iconset
  sips -z 16 16     build/appicon.png --out adOmnia.iconset/icon_16x16.png
  sips -z 32 32     build/appicon.png --out adOmnia.iconset/icon_16x16@2x.png
  sips -z 32 32     build/appicon.png --out adOmnia.iconset/icon_32x32.png
  sips -z 64 64     build/appicon.png --out adOmnia.iconset/icon_32x32@2x.png
  sips -z 128 128   build/appicon.png --out adOmnia.iconset/icon_128x128.png
  sips -z 256 256   build/appicon.png --out adOmnia.iconset/icon_128x128@2x.png
  sips -z 256 256   build/appicon.png --out adOmnia.iconset/icon_256x256.png
  sips -z 512 512   build/appicon.png --out adOmnia.iconset/icon_256x256@2x.png
  sips -z 512 512   build/appicon.png --out adOmnia.iconset/icon_512x512.png
  sips -z 1024 1024 build/appicon.png --out adOmnia.iconset/icon_512x512@2x.png
  iconutil -c icns adOmnia.iconset -o build/installer-assets/adOmnia.icns
  ```
- [ ] Copiare l'icona nel bundle `.app`:
  ```bash
  cp build/installer-assets/adOmnia.icns build/bin/adOmnia.app/Contents/Resources/
  # Aggiornare Info.plist: CFBundleIconFile → adOmnia
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile adOmnia" \
    build/bin/adOmnia.app/Contents/Info.plist
  ```

### D. Code signing (obbligatorio su macOS 10.15+)

- [ ] Listare i certificati disponibili: `security find-identity -v -p codesigning`
- [ ] Firmare l'app con Developer ID:
  ```bash
  codesign --deep --force --verify --verbose \
    --sign "Developer ID Application: Nome (TEAMID)" \
    --options runtime \
    --entitlements build/installer-assets/entitlements.plist \
    build/bin/adOmnia.app
  ```
- [ ] Creare `build/installer-assets/entitlements.plist`:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
  <plist version="1.0"><dict>
    <key>com.apple.security.cs.allow-jit</key><true/>
    <key>com.apple.security.network.client</key><true/>
    <key>com.apple.security.files.user-selected.read-write</key><true/>
  </dict></plist>
  ```
- [ ] Verificare la firma: `codesign --verify --deep --strict build/bin/adOmnia.app`

### E. Creare il DMG branded

- [ ] Creare il background DMG 660×400 px con logo adOmnia e salvare in
  `build/installer-assets/dmg-background.png` (e `@2x` per Retina).
- [ ] Creare il DMG:
  ```bash
  create-dmg \
    --volname "adOmnia" \
    --volicon "build/installer-assets/adOmnia.icns" \
    --background "build/installer-assets/dmg-background.png" \
    --window-pos 200 120 \
    --window-size 660 400 \
    --icon-size 100 \
    --icon "adOmnia.app" 180 180 \
    --hide-extension "adOmnia.app" \
    --app-drop-link 480 180 \
    "dist/adOmnia-1.0.0-darwin-universal.dmg" \
    "build/bin/adOmnia.app"
  ```
  Il `--app-drop-link 480 180` crea la freccia drag-to-Applications automaticamente.

### F. Notarizzazione Apple

- [ ] Sottomettere il DMG ad Apple:
  ```bash
  xcrun notarytool submit "dist/adOmnia-1.0.0-darwin-universal.dmg" \
    --apple-id "tua@email.com" \
    --password "@keychain:AC_PASSWORD" \
    --team-id "TEAMID" \
    --wait
  ```
- [ ] Staple del ticket nel DMG:
  ```bash
  xcrun stapler staple "dist/adOmnia-1.0.0-darwin-universal.dmg"
  ```
- [ ] Verificare: `spctl -a -vvv -t open --context context:primary-signature dist/adOmnia-*.dmg`
- [ ] Testare il DMG su una macchina con Gatekeeper attivo: nessun warning deve apparire.

---

## Linux — AppImage + .deb + .rpm

### A. AppImage (distribuzione universale, consigliata come primo rilascio)

AppImage non richiede installazione — l'utente scarica, rende eseguibile, lancia.
Funziona su qualsiasi distribuzione Linux con glibc ≥ 2.17.

- [ ] Su Linux (o in Docker), installare `linuxdeploy`:
  ```bash
  wget https://github.com/linuxdeploy/linuxdeploy/releases/latest/download/linuxdeploy-x86_64.AppImage
  chmod +x linuxdeploy-x86_64.AppImage
  ```
- [ ] Eseguire il build Wails su Linux:
  ```bash
  wails build -platform linux/amd64 -ldflags "-s -w" -trimpath
  ```
- [ ] Creare la struttura AppDir:
  ```bash
  mkdir -p AppDir/usr/bin
  mkdir -p AppDir/usr/share/icons/hicolor/256x256/apps
  mkdir -p AppDir/usr/share/applications

  cp build/bin/adOmnia AppDir/usr/bin/
  cp build/appicon.png AppDir/usr/share/icons/hicolor/256x256/apps/adomnia.png
  ```
- [ ] Creare il file `.desktop`:
  ```ini
  # AppDir/usr/share/applications/adomnia.desktop
  [Desktop Entry]
  Name=adOmnia
  Exec=adOmnia
  Icon=adomnia
  Type=Application
  Categories=Development;
  Comment=Local-first developer toolbox for API work
  StartupWMClass=adOmnia
  ```
- [ ] Generare l'AppImage:
  ```bash
  ./linuxdeploy-x86_64.AppImage \
    --appdir AppDir \
    --output appimage \
    --desktop-file AppDir/usr/share/applications/adomnia.desktop \
    --icon-file build/appicon.png
  ```
  Produce `adOmnia-x86_64.AppImage`.
- [ ] Rinominare con versione: `mv adOmnia-x86_64.AppImage dist/adOmnia-1.0.0-linux-amd64.AppImage`
- [ ] Testare su Ubuntu, Fedora e Arch (o VM/Docker corrispondenti).

### B. Pacchetto .deb (Debian / Ubuntu)

- [ ] Creare la struttura del pacchetto:
  ```bash
  mkdir -p deb-pkg/DEBIAN
  mkdir -p deb-pkg/usr/bin
  mkdir -p deb-pkg/usr/share/applications
  mkdir -p deb-pkg/usr/share/icons/hicolor/256x256/apps
  mkdir -p deb-pkg/usr/share/doc/adomnia

  cp build/bin/adOmnia deb-pkg/usr/bin/adomnia
  cp build/appicon.png deb-pkg/usr/share/icons/hicolor/256x256/apps/adomnia.png
  cp build/installer-assets/license.txt deb-pkg/usr/share/doc/adomnia/copyright
  ```
- [ ] Creare `deb-pkg/DEBIAN/control`:
  ```
  Package: adomnia
  Version: 1.0.0
  Section: devel
  Priority: optional
  Architecture: amd64
  Maintainer: adOmnia <info@adomnia.dev>
  Description: Local-first developer toolbox
   API client, streaming protocols, debugging tools and extensible
   desktop workflows. No cloud, no telemetry.
  Homepage: https://adomnia.dev
  ```
- [ ] Creare `deb-pkg/DEBIAN/postinst` (aggiorna icone dopo installazione):
  ```bash
  #!/bin/sh
  update-desktop-database -q || true
  gtk-update-icon-cache -f /usr/share/icons/hicolor/ || true
  ```
  ```bash
  chmod 755 deb-pkg/DEBIAN/postinst
  ```
- [ ] Copiare il file `.desktop`:
  ```bash
  cp AppDir/usr/share/applications/adomnia.desktop deb-pkg/usr/share/applications/
  ```
- [ ] Costruire il pacchetto:
  ```bash
  dpkg-deb --build deb-pkg dist/adOmnia-1.0.0-linux-amd64.deb
  ```
- [ ] Verificare il pacchetto: `dpkg-deb --info dist/adOmnia-1.0.0-linux-amd64.deb`
- [ ] Testare installazione su Ubuntu: `sudo dpkg -i dist/adOmnia-1.0.0-linux-amd64.deb`
- [ ] Verificare che l'icona appaia nel launcher GNOME/KDE.
- [ ] Verificare disinstallazione: `sudo apt remove adomnia`

### C. Pacchetto .rpm (Fedora / RHEL / openSUSE)

- [ ] Installare `rpmbuild`: `sudo dnf install rpm-build` (su Fedora/RHEL)
- [ ] Creare la struttura:
  ```bash
  mkdir -p ~/rpmbuild/{SPECS,SOURCES,BUILD,RPMS,SRPMS}
  cp build/bin/adOmnia ~/rpmbuild/SOURCES/
  cp build/appicon.png ~/rpmbuild/SOURCES/adomnia.png
  ```
- [ ] Creare `~/rpmbuild/SPECS/adomnia.spec`:
  ```spec
  Name:           adomnia
  Version:        1.0.0
  Release:        1%{?dist}
  Summary:        Local-first developer toolbox
  License:        MIT
  URL:            https://adomnia.dev

  %description
  API client, streaming protocols, debugging tools and extensible
  desktop workflows. No cloud, no telemetry.

  %install
  mkdir -p %{buildroot}/usr/bin
  mkdir -p %{buildroot}/usr/share/icons/hicolor/256x256/apps
  mkdir -p %{buildroot}/usr/share/applications
  install -m 755 %{_sourcedir}/adOmnia %{buildroot}/usr/bin/adomnia
  install -m 644 %{_sourcedir}/adomnia.png \
    %{buildroot}/usr/share/icons/hicolor/256x256/apps/adomnia.png

  %files
  /usr/bin/adomnia
  /usr/share/icons/hicolor/256x256/apps/adomnia.png
  /usr/share/applications/adomnia.desktop

  %post
  update-desktop-database -q || true
  gtk-update-icon-cache -f /usr/share/icons/hicolor/ || true
  ```
- [ ] Costruire il pacchetto:
  ```bash
  rpmbuild -bb ~/rpmbuild/SPECS/adomnia.spec
  cp ~/rpmbuild/RPMS/x86_64/adomnia-1.0.0-1.*.rpm dist/adOmnia-1.0.0-linux-amd64.rpm
  ```
- [ ] Testare su Fedora: `sudo rpm -i dist/adOmnia-1.0.0-linux-amd64.rpm`
- [ ] Verificare disinstallazione: `sudo rpm -e adomnia`

---

## Build Docker per Linux (cross-build da Windows/macOS)

Per produrre binary e pacchetti Linux senza una macchina Linux fisica:

- [ ] Creare (o aggiornare) `build/Dockerfile`:
  ```dockerfile
  FROM golang:1.25-bookworm

  RUN apt-get update && apt-get install -y \
    libgtk-3-dev libwebkit2gtk-4.1-dev \
    build-essential curl nodejs npm \
    dpkg-dev rpm \
    && rm -rf /var/lib/apt/lists/*

  RUN curl -fsSL https://wails.io/install.sh | bash

  WORKDIR /app
  COPY . .
  RUN npm --prefix frontend install

  CMD ["wails", "build", "-platform", "linux/amd64", \
       "-ldflags", "-s -w", "-trimpath"]
  ```
- [ ] Buildare e lanciare:
  ```bash
  docker build -f build/Dockerfile -t adomnia-linux-builder .
  docker run --rm -v $(pwd)/dist:/app/dist adomnia-linux-builder
  ```

---

## Automatizzare tutto con GitHub Actions

- [ ] Creare `.github/workflows/release.yml`:
  ```yaml
  name: Release

  on:
    push:
      tags: ['v*']

  jobs:
    windows:
      runs-on: windows-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-go@v5
          with: { go-version: '1.25' }
        - run: npm --prefix frontend install
        - run: wails build -platform windows/amd64 -nsis -ldflags "-s -w" -trimpath
        - uses: actions/upload-artifact@v4
          with:
            name: windows
            path: dist/*.exe

    macos:
      runs-on: macos-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-go@v5
          with: { go-version: '1.25' }
        - run: npm --prefix frontend install
        - run: brew install create-dmg
        - run: wails build -platform darwin/universal -ldflags "-s -w" -trimpath
        # ... codesign + notarize + create-dmg steps
        - uses: actions/upload-artifact@v4
          with:
            name: macos
            path: dist/*.dmg

    linux:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev
        - uses: actions/setup-go@v5
          with: { go-version: '1.25' }
        - run: npm --prefix frontend install
        - run: wails build -platform linux/amd64 -ldflags "-s -w" -trimpath
        # ... linuxdeploy AppImage + dpkg-deb steps
        - uses: actions/upload-artifact@v4
          with:
            name: linux
            path: dist/*

    release:
      needs: [windows, macos, linux]
      runs-on: ubuntu-latest
      steps:
        - uses: actions/download-artifact@v4
        - uses: softprops/action-gh-release@v2
          with:
            files: |
              windows/*.exe
              macos/*.dmg
              linux/*.AppImage
              linux/*.deb
              linux/*.rpm
  ```
- [ ] Aggiungere secrets nel repository GitHub:
  - `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` per notarization macOS
  - `WINDOWS_CERT` (base64) e `WINDOWS_CERT_PASSWORD` per code signing Windows

---

## Checklist finale pre-release

- [ ] Tutti e tre gli installer testati su macchina pulita (non la macchina di sviluppo).
- [ ] L'icona appare correttamente nel launcher / taskbar / dock di ogni OS.
- [ ] Il nome visualizzato è "adOmnia" (non "adomnia" o "AdOmnia").
- [ ] La versione visualizzata in "Informazioni" corrisponde al tag di release.
- [ ] Uninstaller (Windows) / drag-to-Trash (macOS) / `apt remove` (Linux) pulisce tutto.
- [ ] Nessun warning di sicurezza al lancio su macchina pulita (Windows SmartScreen, macOS Gatekeeper).
- [ ] GitHub Release creata con tutti e tre gli artifact allegati.
- [ ] `docs/BUILD.md` aggiornato con i comandi di release definitivi.
