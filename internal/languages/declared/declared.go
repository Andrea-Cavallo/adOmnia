// Package declared adds editor support to languages that need nothing beyond a language server on
// PATH: one row in table.go per language (file extensions, the server and how to install it).
// The host treats every row like any other lsp.ServerProvider: editor notice, status, trust check.
//
// A row may also name its project manifests (units), an interpreter (script Run), a script debugger
// and a test command that writes a JUnit or TRX report. LimitCapabilities reports only what the row
// really has. A language that grows framework knowledge moves to its own adapter in internal/languages.
package declared

import (
	"fmt"
	"os"
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
	// npm is the pinned package of the first server when npm can install it into adOmnia's tools
	// folder (the Install… button); empty means the hint is the only way.
	npm string
	// pinned is a server adOmnia downloads at a fixed release into its tools folder (Install…).
	pinned *pinnedServer
	// tool is a .NET tool adOmnia installs at a pinned version into its tools folder (Install…).
	tool *dotnetTool
	// manifests are lower-case file name patterns that make a folder a project unit (CMakeLists.txt, *.csproj).
	manifests []string
	// interpreters run one source file (the first found on PATH wins); empty means no script Run.
	interpreters []server
	// dotnet: projects run with `dotnet run` (C#, F#).
	dotnet bool
	// debugger debugs a script with a DAP adapter on PATH; nil means no script Debug.
	debugger *debugger
	// test runs the unit's tests into a report folder; nil means no Test.
	test *tester
	// build: adOmnia can compile one source file (and its folder's sources) and run it, so a C/C++
	// file with main gets a Play action without a pre-built executable.
	build bool
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
		switch {
		case d.native:
			adapters = append(adapters, nativeAdapter{adapter{d}})
		case d.dotnet:
			adapters = append(adapters, dotnetAdapter{adapter{d}})
		case len(d.interpreters) > 0:
			adapters = append(adapters, scriptAdapter{adapter{d}})
		default:
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

// LimitCapabilities hides what this row lacks: every adapter type implements tests and unit
// detection, and script rows implement debug, but only some rows can use them.
func (a adapter) LimitCapabilities(c language.Capabilities) language.Capabilities {
	c.ProjectDetection = len(a.manifests) > 0
	c.Tests = a.test != nil
	c.Debug = a.native || a.dotnet || a.debugger != nil
	return c
}

func (a adapter) ID() string   { return a.id }
func (a adapter) Name() string { return a.name }

func (a adapter) DocumentLanguageID(path string) (string, bool) { return a.languageID(path) }

func (a adapter) find(toolsRoot string) (server, string, string, bool) {
	if a.npm != "" && toolsRoot != "" {
		if binary := managedBinary(toolsRoot, a.servers[0].command); binary != "" {
			return a.servers[0], binary, "managed", true
		}
	}
	if a.pinned != nil {
		if binary, args, ok := a.pinned.command(toolsRoot, a.servers[0].args); ok {
			return server{command: a.servers[0].command, args: args}, binary, "managed", true
		}
	}
	if a.tool != nil {
		if binary := a.tool.managed(toolsRoot); binary != "" {
			return a.servers[0], binary, "managed", true
		}
	}
	for _, candidate := range a.servers {
		if binary, err := lookPath(candidate.command); err == nil {
			return candidate, binary, "PATH", true
		}
	}
	return server{}, "", "", false
}

// managedBinary is the npm shim in adOmnia's tools folder, shared with the web language servers.
func managedBinary(toolsRoot, name string) string {
	directory := lsp.ManagedBinDirectory(toolsRoot)
	for _, candidate := range []string{name + ".cmd", name} {
		if info, err := os.Stat(filepath.Join(directory, candidate)); err == nil && info.Mode().IsRegular() {
			return filepath.Join(directory, candidate)
		}
	}
	return ""
}

func (a adapter) LocateServer(_, toolsRoot string) lsp.ServerInfo {
	candidate, binary, source, ok := a.find(toolsRoot)
	if !ok {
		return lsp.ServerInfo{Language: a.id, Name: a.servers[0].command,
			Error: fmt.Sprintf("%s is not on PATH: %s, then reopen the file", a.servers[0].command, a.hint)}
	}
	return lsp.ServerInfo{Language: a.id, Name: candidate.command, Available: true, Binary: binary, Source: source}
}

func (a adapter) ServerSpec(root, toolsRoot string) (lsp.ServerSpec, error) {
	candidate, binary, _, ok := a.find(toolsRoot)
	if !ok {
		return lsp.ServerSpec{}, fmt.Errorf("%s", a.LocateServer(root, toolsRoot).Error)
	}
	arguments := candidate.args
	if candidate.command == "clangd" {
		arguments = clangdArguments(root, toolsRoot, arguments)
	}
	return lsp.ServerSpec{Language: a.id, Name: candidate.command, Binary: binary, Arguments: arguments}, nil
}

// InstallPlan installs npm-distributed servers into adOmnia's tools folder, after confirmation.
// The others come from their ecosystem's installer (dotnet, gem, ghcup…): the notice shows the hint.
func (a adapter) InstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if a.pinned != nil {
		return a.pinned.installPlan(toolsRoot, a.id, a.hint)
	}
	if a.tool != nil {
		return a.tool.installPlan(toolsRoot, a.id, a.hint)
	}
	if a.npm == "" || toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("%s", a.hint)
	}
	// Only a PATH lookup: this runs for every missing server when the editor lists them, so no
	// `npm --version` here. A broken npm fails visibly in the Run console instead.
	npm, err := lookPath(lsp.NPM)
	if err != nil {
		return lsp.InstallPlan{}, fmt.Errorf("npm is not on PATH: install Node.js to install %s here, or %s", a.servers[0].command, a.hint)
	}
	prefix := lsp.ManagedToolsPrefix(toolsRoot)
	return lsp.InstallPlan{
		Task: "install-" + a.id + "-language-server", Title: "Install " + a.servers[0].command + "?", Label: "Installing " + a.servers[0].command + "…",
		Note:       "Downloads the package from the npm registry into adOmnia's own tools folder, never into your project. It also runs its install scripts. The output appears in the Run console.",
		Command:    "npm install --prefix <adOmnia tools folder> " + a.npm,
		Executable: npm, Arguments: []string{"install", "--no-audit", "--no-fund", "--prefix", prefix, a.npm},
		Directory: prefix, Prepare: func() error { return os.MkdirAll(prefix, 0o755) },
		Languages: []string{a.id},
	}, nil
}
