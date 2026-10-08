// Package windowchrome decides, before the frontend loads, whether the main
// window uses the app's integrated title bar or the system frame.
package windowchrome

import (
	"encoding/json"
	"os"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	App    = "app"
	AppX11 = "app-xwayland"
	System = "system"
)

// Normalize maps a stored value to App or System.
func Normalize(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case AppX11:
		// Backward-compatible alias: never force XWayland for old settings.
		return App
	case System:
		return System
	default:
		return App
	}
}

// Default: barra integrata nell'app, tranne su Linux dove WebKitGTK/Wayland resta sulla cornice di sistema.
func Default(goos string) string {
	if goos == "linux" {
		return System
	}
	return App
}

// IsApp reports whether the mode draws the title bar inside the app.
func IsApp(mode string) bool {
	return mode == App || mode == AppX11
}

// ReadStartup reads the settings JSON from the bbolt DB read-only, without
// waiting for the storage package to open it.
func ReadStartup(dbPath, bucket, key, goos string) string {
	if _, err := os.Stat(dbPath); err != nil {
		return Default(goos)
	}
	db, err := bolt.Open(dbPath, 0600, &bolt.Options{ReadOnly: true, Timeout: 250 * time.Millisecond})
	if err != nil {
		return Default(goos)
	}
	defer db.Close()
	var settingsJSON []byte
	_ = db.View(func(tx *bolt.Tx) error {
		if b := tx.Bucket([]byte(bucket)); b != nil {
			settingsJSON = append([]byte(nil), b.Get([]byte(key))...)
		}
		return nil
	})
	return FromSettings(settingsJSON, goos)
}

// FromSettings rispecchia le migrazioni del frontend (settings.ts) per decidere la cornice
// prima che il frontend riscriva le impostazioni: così il cambio vale già a questo avvio.
func FromSettings(settingsJSON []byte, goos string) string {
	fallback := Default(goos)
	var parsed struct {
		Version    int `json:"version"`
		Appearance struct {
			WindowChrome string `json:"windowChrome"`
		} `json:"appearance"`
	}
	if json.Unmarshal(settingsJSON, &parsed) != nil || parsed.Appearance.WindowChrome == "" {
		return fallback
	}
	chrome := parsed.Appearance.WindowChrome
	// v3: il vecchio default 'app' era diventato 'system'.
	if parsed.Version < 3 && chrome == App {
		chrome = System
	}
	// v13: la barra integrata torna predefinita fuori da Linux, una volta sola (v12 la saltava per chi aveva scelto System).
	if parsed.Version < 13 && chrome == System && goos != "linux" {
		chrome = App
	}
	return Normalize(chrome)
}
