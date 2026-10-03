package sdk

import (
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// caseInsensitivePaths vale per i filesystem predefiniti di Windows e macOS.
var caseInsensitivePaths = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

// ToolVersionEntry è la versione di un binario (gopls, dlv, linter) valida finché il binario non cambia.
type ToolVersionEntry struct {
	Stamp   string `json:"stamp"`
	Version string `json:"version"`
}

const maxToolVersions = 64

// toolVersions evita di avviare `<tool> version` a ogni avvio di gopls, debug o lint: con un antivirus
// aziendale ogni processo può costare secondi. La chiave è il percorso, la validità è BinaryStamp.
var toolVersions = struct {
	sync.Mutex
	entries map[string]ToolVersionEntry
}{entries: map[string]ToolVersionEntry{}}

func toolVersionKey(binary string) string {
	key := filepath.Clean(binary)
	if caseInsensitivePaths {
		key = strings.ToLower(key)
	}
	return key
}

// CachedVersion interroga il binario solo se è nuovo o cambiato; gli errori non vengono memorizzati.
func CachedVersion(binary string, query func(string) (string, error)) (string, error) {
	stamp := BinaryStamp(binary)
	key := toolVersionKey(binary)
	toolVersions.Lock()
	entry, ok := toolVersions.entries[key]
	toolVersions.Unlock()
	if ok && stamp != "" && entry.Stamp == stamp {
		return entry.Version, nil
	}
	version, err := query(binary)
	if err != nil || stamp == "" {
		return version, err
	}
	toolVersions.Lock()
	if len(toolVersions.entries) >= maxToolVersions {
		toolVersions.entries = map[string]ToolVersionEntry{}
	}
	toolVersions.entries[key] = ToolVersionEntry{Stamp: stamp, Version: version}
	toolVersions.Unlock()
	return version, nil
}

// RestoreVersions ripristina le versioni salvate senza sovrascrivere quelle già note.
func RestoreVersions(entries map[string]ToolVersionEntry) {
	toolVersions.Lock()
	defer toolVersions.Unlock()
	for key, entry := range entries {
		if len(toolVersions.entries) >= maxToolVersions {
			return
		}
		if _, known := toolVersions.entries[key]; !known {
			toolVersions.entries[key] = entry
		}
	}
}

// VersionsSnapshot restituisce le versioni da salvare (nil se nessuna).
func VersionsSnapshot() map[string]ToolVersionEntry {
	toolVersions.Lock()
	defer toolVersions.Unlock()
	if len(toolVersions.entries) == 0 {
		return nil
	}
	snapshot := make(map[string]ToolVersionEntry, len(toolVersions.entries))
	for key, entry := range toolVersions.entries {
		snapshot[key] = entry
	}
	return snapshot
}
