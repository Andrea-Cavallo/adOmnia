//go:build !linux

package main

import "github.com/wailsapp/wails/v2/pkg/options"

func applyPlatformOptions(appOptions *options.App) {}
