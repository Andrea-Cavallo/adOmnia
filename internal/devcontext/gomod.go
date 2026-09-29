package devcontext

import (
	"fmt"
	"path"
	"strings"
)

func detectGoMod(rel string, data []byte) ([]Entity, error) {
	for i, line := range strings.Split(string(data), "\n") {
		rest, ok := strings.CutPrefix(strings.TrimSpace(line), "module ")
		if !ok {
			continue
		}
		module := strings.Trim(strings.TrimSpace(rest), `"`)
		return []Entity{entity("module", module, module, ConfidenceCertain,
			map[string]string{"dir": path.Dir(rel)}, Source{"gomod", rel, i + 1})}, nil
	}
	return nil, fmt.Errorf("no module directive")
}
