package nativeicon

import (
	"embed"
	"fmt"
)

//go:embed artwork/*
var artwork embed.FS

func validateMode(mode string) error {
	if mode != "dark" && mode != "light" {
		return fmt.Errorf("invalid native icon mode: %q", mode)
	}
	return nil
}

func pngForMode(mode string) []byte {
	data, _ := artwork.ReadFile("artwork/" + mode + ".png")
	return data
}
