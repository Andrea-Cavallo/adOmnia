# adOmnia concept icon

The editable hexagonal alien mark is `assets/images/adomnia-mark.svg`.
The white mark on the dark tile is the default executable/launcher icon
(the neon gradient tile is kept as `assets/icons/icon-neon.ico`). Transparent white and
black marks follow the app theme on every platform; Win95 and Sketch keep
their dedicated artwork. This changes the app logo and favicon immediately.

Generate PNGs and multi-resolution ICOs with `node scripts/generate-concept-icons.mjs`
(`build.ps1` and `build-linux.ps1` run it through `scripts/sync-icons.ps1` when the mark is newer than the icons)
(requires `sharp`, also discoverable through `NODE_PATH`). Windows embeds
`build/windows/icon.ico`; macOS generates ICNS from `build/appicon.png`;
Linux packages the PNG sizes and `adomnia-symbolic.svg`. GTK4 builds regenerate
the embedded icon resource using `glib-compile-resources` (GLib development tools).

The running application's native icon follows the app theme: dark tile on dark,
white tile on light. Windows applies both small and large HWND icons;
macOS uses the application Dock icon; Linux applies GTK window icons using
embedded PNGs copied to the local user cache. Linux launcher/taskbar behavior
also depends on the compositor, which may prefer the installed desktop entry.
The icon embedded in an executable and pinned desktop shortcuts stays static;
Explorer and closed/pinned launchers retain the embedded dark-tile icon.
`assets/icons/icon-white.ico` and `icon-black.ico` are supplied for Windows
shortcut customization. Linux desktops may recolor `adomnia-symbolic.svg`
where symbolic application icons are supported; ordinary launchers use the dark tile.

Windows may cache an old shortcut icon for an existing executable path. The separate
`bin/adomnia-concept.exe` build allows checking the new icon under a fresh name.
