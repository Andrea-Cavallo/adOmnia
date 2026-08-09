//go:build linux

package main

import (
	_ "embed"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed assets/icons/linux/adOmnia_256x256.png
var linuxWindowIcon []byte

func applyPlatformOptions(appOptions *application.Options) {
	appOptions.Linux.ProgramName = "adOmnia"
}
