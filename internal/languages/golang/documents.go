package golang

import (
	"path/filepath"
	"strings"
)

// DocumentLanguageID riconosce i file serviti da gopls: sorgenti Go, go.mod e go.work.
func (*Language) DocumentLanguageID(path string) (string, bool) {
	base := strings.ToLower(filepath.Base(path))
	switch {
	case base == "go.mod":
		return "go.mod", true
	case base == "go.work":
		return "go.work", true
	case strings.HasSuffix(base, ".go"):
		return "go", true
	}
	return "", false
}
