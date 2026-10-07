package plugins

import (
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Developer mode: a plugin installed from a source folder stays linked to it. Every change in the folder
// reinstalls the plugin (hot reload), re-verifies its signature and is recorded in the plugin log,
// together with log.info/log.error calls, WASM stderr and execution errors.

const (
	maxPluginLogEntries = 500
	devReloadDebounce   = 300 * time.Millisecond
)

// PluginLogEntry is one line of a plugin's log.
type PluginLogEntry struct {
	Time    string `json:"time"`
	Level   string `json:"level"` // info, error, reload
	Message string `json:"message"`
}

var (
	pluginLogsMu sync.Mutex
	pluginLogs   = map[string][]PluginLogEntry{}

	devLinksMu sync.Mutex
	devLinks   = map[string]*fsnotify.Watcher{}
)

func appendPluginLog(pluginID, level, message string) {
	if pluginID == "" {
		return
	}
	pluginLogsMu.Lock()
	defer pluginLogsMu.Unlock()
	entries := append(pluginLogs[pluginID], PluginLogEntry{Time: time.Now().Format(time.RFC3339Nano), Level: level, Message: message})
	if len(entries) > maxPluginLogEntries {
		entries = entries[len(entries)-maxPluginLogEntries:]
	}
	pluginLogs[pluginID] = entries
}

// GetPluginLogs returns the latest log lines of a plugin, oldest first.
func (pm *PluginManager) GetPluginLogs(id string) []PluginLogEntry {
	pluginLogsMu.Lock()
	defer pluginLogsMu.Unlock()
	return append([]PluginLogEntry(nil), pluginLogs[id]...)
}

// ClearPluginLogs empties a plugin's log.
func (pm *PluginManager) ClearPluginLogs(id string) {
	pluginLogsMu.Lock()
	delete(pluginLogs, id)
	pluginLogsMu.Unlock()
}

// LinkDevPlugin installs a plugin from a source folder and reloads it whenever the folder changes.
func (pm *PluginManager) LinkDevPlugin(sourceDir string) (*PluginInstance, error) {
	root, err := filepath.Abs(sourceDir)
	if err != nil {
		return nil, fmt.Errorf("invalid plugin directory: %w", err)
	}
	inst, err := pm.InstallPluginDirectory(root)
	if err != nil {
		return nil, err
	}
	pm.mu.Lock()
	inst.DevSource = root
	if err := pm.savePluginStateInternal(); err != nil {
		log.Printf("[plugins] warning: failed to persist dev link: %v", err)
	}
	pm.mu.Unlock()
	if err := pm.watchDevSource(inst.Manifest.ID, root); err != nil {
		return nil, err
	}
	appendPluginLog(inst.Manifest.ID, "reload", "linked to "+root)
	copy := *inst
	return &copy, nil
}

// UnlinkDevPlugin stops watching the source folder; the installed copy stays.
func (pm *PluginManager) UnlinkDevPlugin(id string) error {
	stopDevWatch(id)
	pm.mu.Lock()
	defer pm.mu.Unlock()
	inst, ok := pm.plugins[id]
	if !ok {
		return fmt.Errorf("plugin not found: %s", id)
	}
	inst.DevSource = ""
	return pm.savePluginStateInternal()
}

// ReloadDevPlugin reinstalls a linked plugin from its source folder now.
func (pm *PluginManager) ReloadDevPlugin(id string) error {
	pm.mu.RLock()
	inst, ok := pm.plugins[id]
	source := ""
	if ok {
		source = inst.DevSource
	}
	pm.mu.RUnlock()
	if source == "" {
		return fmt.Errorf("plugin %s is not linked to a source folder", id)
	}
	if _, err := pm.InstallPluginDirectory(source); err != nil {
		appendPluginLog(id, "error", "reload failed: "+err.Error())
		return err
	}
	appendPluginLog(id, "reload", "reloaded from "+source)
	return nil
}

func (pm *PluginManager) watchDevSource(id, root string) error {
	stopDevWatch(id)
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("cannot watch the plugin folder: %w", err)
	}
	add := func() {
		_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err == nil && entry.IsDir() {
				_ = watcher.Add(path)
			}
			return nil
		})
	}
	add()
	devLinksMu.Lock()
	devLinks[id] = watcher
	devLinksMu.Unlock()
	go func() {
		var timer *time.Timer
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() && event.Op&fsnotify.Create != 0 {
					add()
				}
				if timer != nil {
					timer.Stop()
				}
				timer = time.AfterFunc(devReloadDebounce, func() {
					if err := pm.ReloadDevPlugin(id); err == nil {
						pm.refreshSignatures()
						notifyReload(id)
					}
				})
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				appendPluginLog(id, "error", "watch: "+err.Error())
			}
		}
	}()
	return nil
}

func stopDevWatch(id string) {
	devLinksMu.Lock()
	watcher := devLinks[id]
	delete(devLinks, id)
	devLinksMu.Unlock()
	if watcher != nil {
		_ = watcher.Close()
	}
}

// resumeDevLinks restarts the watchers of plugins linked in a previous session.
func (pm *PluginManager) resumeDevLinks() {
	pm.mu.RLock()
	links := map[string]string{}
	for id, inst := range pm.plugins {
		if inst.DevSource != "" {
			links[id] = inst.DevSource
		}
	}
	pm.mu.RUnlock()
	for id, source := range links {
		if info, err := os.Stat(source); err != nil || !info.IsDir() {
			appendPluginLog(id, "error", "linked source folder is gone: "+source)
			continue
		}
		if err := pm.watchDevSource(id, source); err != nil {
			appendPluginLog(id, "error", err.Error())
		}
	}
}

func notifyReload(id string) {
	notifierMu.RLock()
	callback := notifier
	notifierMu.RUnlock()
	if callback != nil {
		callback(PluginNotification{PluginID: id, Title: "Plugin reloaded", Message: id + " was reinstalled from its source folder.", Type: "info"})
	}
}
