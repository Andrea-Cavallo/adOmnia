package goide

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// dependencyGraphCache conserva in memoria l'ultimo grafo dipendenze per
// (sessione, directory di modulo, binario go). DependencyGraph esegue tre
// comandi go e viene richiesto a ogni apertura del pannello: senza cache ogni
// riapertura ripaga secondi di lavoro identico.
//
// Invalidazione:
//   - stamp: go.mod, go.sum, go.work, go.work.sum e il binario go (dimensione e
//     timestamp) determinano build list e archi; qualsiasi variazione invalida.
//   - filesChanged: le modifiche ai sorgenti cambiano il conteggio dei pacchetti
//     e le dipendenze inutilizzate, quindi il watcher scarta le voci della sessione.
type dependencyGraphCache struct {
	mu      sync.Mutex
	entries map[string]dependencyGraphEntry
}

type dependencyGraphEntry struct {
	report DependencyGraphReport
	stamp  string
}

func newDependencyGraphCache() *dependencyGraphCache {
	return &dependencyGraphCache{entries: make(map[string]dependencyGraphEntry)}
}

func dependencyGraphKey(sessionID SessionID, directory, goBinary string) string {
	return string(sessionID) + "\x00" + directory + "\x00" + goBinary
}

// dependencyModuleStamp descrive i file che determinano il grafo. I file assenti
// contribuiscono comunque allo stamp, così la creazione di go.sum invalida.
func dependencyModuleStamp(directory, goBinary string) string {
	var stamp strings.Builder
	for _, name := range []string{"go.mod", "go.sum", "go.work", "go.work.sum"} {
		writeFileStamp(&stamp, name, filepath.Join(directory, name))
	}
	writeFileStamp(&stamp, "go", goBinary)
	return stamp.String()
}

func writeFileStamp(stamp *strings.Builder, name, path string) {
	info, err := os.Stat(path)
	if err != nil {
		fmt.Fprintf(stamp, "%s:-\n", name)
		return
	}
	fmt.Fprintf(stamp, "%s:%d:%d\n", name, info.Size(), info.ModTime().UnixNano())
}

func (c *dependencyGraphCache) get(key, stamp string) (DependencyGraphReport, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || entry.stamp != stamp {
		return DependencyGraphReport{}, false
	}
	return entry.report, true
}

func (c *dependencyGraphCache) set(key, stamp string, report DependencyGraphReport) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = dependencyGraphEntry{report: report, stamp: stamp}
}

// invalidateSession scarta tutte le voci di una sessione (modifiche su disco).
func (c *dependencyGraphCache) invalidateSession(sessionID SessionID) {
	prefix := string(sessionID) + "\x00"
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.entries {
		if strings.HasPrefix(key, prefix) {
			delete(c.entries, key)
		}
	}
}
