//go:build linux

package main

import (
	_ "embed"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed assets/icons/linux/adOmnia_256x256.png
var linuxWindowIcon []byte

func applyPlatformOptions(appOptions *application.Options) {
	// Must match the installed adomnia.desktop filename (case-sensitive on Wayland).
	appOptions.Linux.ProgramName = "adomnia"
	appOptions.Icon = linuxWindowIcon
}
