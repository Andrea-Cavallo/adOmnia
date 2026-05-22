package main

import (
	"encoding/json"
	"os"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	windowChromeApp    = "app"
	windowChromeAppX11 = "app-xwayland"
	windowChromeSystem = "system"
)

var startupWindowChrome = readStartupWindowChrome()

func normalizeWindowChrome(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case windowChromeAppX11:
		return windowChromeAppX11
	case windowChromeSystem:
		return windowChromeSystem
	default:
		return windowChromeApp
	}
}

func readStartupWindowChrome() string {
	path := storePath()
	if _, err := os.Stat(path); err != nil {
		return windowChromeApp
	}

	db, err := bolt.Open(path, 0600, &bolt.Options{
		ReadOnly: true,
		Timeout:  250 * time.Millisecond,
	})
	if err != nil {
		return windowChromeApp
	}
	defer db.Close()

	var settingsJSON []byte
	err = db.View(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(settingsBucket))
		if bucket == nil {
			return nil
		}
		value := bucket.Get([]byte(settingsKey))
		if value == nil {
			return nil
		}
		settingsJSON = append([]byte(nil), value...)
		return nil
	})
	if err != nil || len(settingsJSON) == 0 {
		return windowChromeApp
	}

	var parsed struct {
		Appearance struct {
			WindowChrome string `json:"windowChrome"`
		} `json:"appearance"`
	}
	if err := json.Unmarshal(settingsJSON, &parsed); err != nil {
		return windowChromeApp
	}
	return normalizeWindowChrome(parsed.Appearance.WindowChrome)
}

func (a *App) GetStartupWindowChrome() string {
	return startupWindowChrome
}

func isAppChrome(mode string) bool {
	return mode == windowChromeApp || mode == windowChromeAppX11
}
