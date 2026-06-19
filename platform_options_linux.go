//go:build linux

package main

import (
	_ "embed"

	"github.com/wailsapp/wails/v2/pkg/options"
	linuxopts "github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed assets/icons/linux/adomnia_256x256.png
var linuxWindowIcon []byte

func applyPlatformOptions(appOptions *options.App) {
	appOptions.Linux = &linuxopts.Options{
		Icon:        linuxWindowIcon,
		ProgramName: "adOmnia",
	}
}
