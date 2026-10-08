package main

import (
	"adomnia/internal/nativeicon"
	"fmt"
)

// SetNativeIconMode updates running windows; executable/shortcut resources stay static.
func (a *App) SetNativeIconMode(mode string) error {
	if a.desktop == nil {
		return fmt.Errorf("desktop runtime is not initialized")
	}
	return nativeicon.Apply(a.desktop, mode)
}
