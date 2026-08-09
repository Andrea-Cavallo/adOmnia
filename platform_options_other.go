//go:build !linux

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func applyPlatformOptions(appOptions *application.Options) {}
