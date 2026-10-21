// Package python implements local Python project detection and script/module execution.
// Detection only reads file names; it never imports or executes project code.
package python

import (
	"path/filepath"
	"strings"
)

const ID = "python"

type Language struct{}

func New() *Language           { return &Language{} }
func (*Language) ID() string   { return ID }
func (*Language) Name() string { return "Python" }
func (*Language) DocumentLanguageID(path string) (string, bool) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".py", ".pyi":
		return ID, true
	}
	return "", false
}
