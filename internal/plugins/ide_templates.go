package plugins

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// ResolveIDETemplateFS resolves only a declared template of an enabled, intact plugin.
// A package helper keeps fs.FS out of the desktop binding surface.
func ResolveIDETemplateFS(pm *PluginManager, pluginID, templateID string) (fs.FS, error) {
	pm.refreshSignatures()
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	inst, ok := pm.plugins[pluginID]
	if !ok || !inst.Enabled || inst.Error != "" {
		return nil, fmt.Errorf("plugin unavailable: %s", pluginID)
	}
	for _, t := range inst.Manifest.Contributes.Templates {
		if t.ID != templateID {
			continue
		}
		root, err := filepath.EvalSymlinks(inst.InstallDir)
		if err != nil {
			return nil, err
		}
		dir, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(t.Directory)))
		if err != nil {
			return nil, err
		}
		rel, err := filepath.Rel(root, dir)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("template escapes plugin directory")
		}
		return os.DirFS(dir), nil
	}
	return nil, fmt.Errorf("template not declared: %s", templateID)
}
