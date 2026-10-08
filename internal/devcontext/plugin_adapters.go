package devcontext

import (
	"adomnia/internal/plugins"
	"golang.org/x/mod/modfile"
	"os"
	"path/filepath"
)

// WithPluginAdapters recognizes direct module dependencies; it does not invent live services or DSNs.
func WithPluginAdapters(snapshot Snapshot, contributions []plugins.Contribution) Snapshot {
	var detected []Entity
	seen := map[string]bool{}
	for _, module := range snapshot.Entities {
		if module.Kind != "module" {
			continue
		}
		for _, src := range module.Sources {
			if src.Detector != "gomod" || seen[src.File] {
				continue
			}
			seen[src.File] = true
			full := filepath.Join(snapshot.Root, filepath.FromSlash(src.File))
			info, err := os.Stat(full)
			if err != nil || info.Size() > maxFileBytes {
				continue
			}
			data, err := os.ReadFile(full)
			if err != nil {
				continue
			}
			parsed, err := modfile.ParseLax(src.File, data, nil)
			if err != nil {
				continue
			}
			for _, requirement := range parsed.Require {
				if requirement.Indirect {
					continue
				}
				for _, c := range contributions {
					if c.Kind != "adapter" {
						continue
					}
					for _, dependency := range c.Modules {
						if dependency != requirement.Mod.Path {
							continue
						}
						kind := "service"
						if c.AdapterKind == "database" {
							kind = "datasource"
						}
						detected = append(detected, entity(kind, "plugin:"+c.PluginID+":"+c.ID+":"+src.File, c.Title, ConfidenceInferred, map[string]string{"adapterKind": c.AdapterKind, "adapter": c.ID, "pluginId": c.PluginID, "module": dependency, "version": requirement.Mod.Version, "origin": "plugin", "detection": "direct-dependency"}, Source{"plugin-adapter", src.File, requirement.Syntax.Start.Line}))
					}
				}
			}
		}
	}
	snapshot.Entities = merge(snapshot.Entities, detected)
	return snapshot
}
