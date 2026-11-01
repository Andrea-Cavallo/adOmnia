// Package declared adds editor support to languages that need nothing beyond a language server on
// PATH: one row in table.go per language (file extensions, the server and how to install it).
// The host treats every row like any other lsp.ServerProvider: editor notice, status, trust check.
//
// A language that grows Run/Debug/Test or project detection moves to its own adapter in
// internal/languages.
package declared

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

// server is one language server command; the first one found on PATH wins.
type server struct {
	command string
	args    []string
}

type definition struct {
	id, name string
	// editor is the Monaco language id of the files (usually equal to the LSP languageId).
	editor string
	// extensions maps a lower-case extension to the LSP languageId sent in didOpen.
	extensions map[string]string
	// filenames maps a lower-case file name without a useful extension (Dockerfile) to its languageId.
	filenames map[string]string
	servers   []server
	// hint says how to install the first server; shown in the editor notice.
	hint string
	// native: programs are native code, so the language runs and debugs a built executable.
	native bool
}

// lookPath is replaced in tests. exec.LookPath honours PATHEXT, so npm's .cmd shims are found on Windows.
var (
	defaultLookPath = exec.LookPath
	lookPath        = defaultLookPath
)

type adapter struct{ definition }

// Languages returns one adapter per table row.
func Languages() []language.Language {
	adapters := make([]language.Language, 0, len(definitions))
	for _, d := range definitions {
		if d.native {
			adapters = append(adapters, nativeAdapter{adapter{d}})
		} else {
			adapters = append(adapters, adapter{d})
		}
	}
	return adapters
}

// EditorLanguage is the Monaco language id of path when a table row owns it.
func EditorLanguage(path string) (string, bool) {
	for _, d := range definitions {
		if _, ok := d.languageID(path); ok {
			return d.editor, true
		}
	}
	return "", false
}

func (d definition) languageID(path string) (string, bool) {
	base := strings.ToLower(filepath.Base(path))
	if id, ok := d.filenames[base]; ok {
		return id, true
	}
	id, ok := d.extensions[filepath.Ext(base)]
	return id, ok
}

func (a adapter) ID() string   { return a.id }
func (a adapter) Name() string { return a.name }

func (a adapter) DocumentLanguageID(path string) (string, bool) { return a.languageID(path) }

func (a adapter) find() (server, string, bool) {
	for _, candidate := range a.servers {
		if binary, err := lookPath(candidate.command); err == nil {
			return candidate, binary, true
		}
	}
	return server{}, "", false
}

func (a adapter) LocateServer(_, _ string) lsp.ServerInfo {
	candidate, binary, ok := a.find()
	if !ok {
		return lsp.ServerInfo{Language: a.id, Name: a.servers[0].command,
			Error: fmt.Sprintf("%s is not on PATH: %s, then reopen the file", a.servers[0].command, a.hint)}
	}
	return lsp.ServerInfo{Language: a.id, Name: candidate.command, Available: true, Binary: binary, Source: "PATH"}
}

func (a adapter) ServerSpec(root, toolsRoot string) (lsp.ServerSpec, error) {
	candidate, binary, ok := a.find()
	if !ok {
		return lsp.ServerSpec{}, fmt.Errorf("%s", a.LocateServer(root, toolsRoot).Error)
	}
	return lsp.ServerSpec{Language: a.id, Name: candidate.command, Binary: binary, Arguments: candidate.args}, nil
}

// InstallPlan: these servers come from each ecosystem's own installer (dotnet, gem, npm, ghcup…),
// so the notice shows the hint instead of an Install button.
// ponytail: add a managed InstallPlan per language when one is worth owning (npm ones are cheap).
func (a adapter) InstallPlan(string) (lsp.InstallPlan, error) {
	return lsp.InstallPlan{}, fmt.Errorf("%s", a.hint)
}
