package main

import (
	"os"
	"path/filepath"
)

var (
	Version    = "dev"
	BuildDate  = "unknown"
	GitCommit  = "unknown"
	serverPort int
	isDevMode  bool
)

func dataDir() string {
	dir := os.Getenv("APPDATA")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config")
	}
	p := filepath.Join(dir, "adomnia")
	os.MkdirAll(p, 0755)
	return p
}
