package codestudio

import (
	"os"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/workspace"
)

type (
	DiskChangeKind = workspace.DiskChangeKind
	DiskChange     = workspace.DiskChange
)

const (
	FileCreated = workspace.FileCreated
	FileChanged = workspace.FileChanged
	FileDeleted = workspace.FileDeleted
)

func readTextFile(path string) (string, os.FileInfo, string, error) {
	return workspace.ReadTextFile(path)
}
func diskToken(data []byte, info os.FileInfo) string { return workspace.DiskToken(data, info) }
func newID(prefix string) string                     { return workspace.NewID(prefix) }
