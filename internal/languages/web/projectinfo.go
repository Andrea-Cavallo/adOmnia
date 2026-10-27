package web

import (
	"encoding/json/v2"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// Package manager supportati.
const (
	NPM  = "npm"
	PNPM = "pnpm"
	Yarn = "yarn"
	Bun  = "bun"
)

// Strumenti di sviluppo riconosciuti dal testo dello script o dalle dipendenze.
const (
	ToolVite    = "vite"
	ToolNext    = "next"
	ToolCRA     = "react-scripts"
	ToolAngular = "angular"
	ToolAstro   = "astro"
	ToolNuxt    = "nuxt"
	ToolNest    = "nest"
	ToolWebpack = "webpack"
	ToolUnknown = ""
)

// devScriptNames sono gli script cercati, in ordine di preferenza, per avviare il dev server.
// start:dev (Nest) viene prima di start, che nei progetti Nest avvia senza watch.
var devScriptNames = []string{"dev", "start:dev", "start", "serve", "develop"}

// Info descrive un progetto Node.js o statico: ciò che serve per avviarlo, senza eseguire nulla.
type Info struct {
	// Dir è la cartella del progetto (quella del package.json), assoluta.
	Dir string `json:"dir"`
	// Relative è Dir rispetto alla radice aperta nell'IDE ("." per la radice).
	Relative string `json:"relative"`
	Name     string `json:"name,omitempty"`
	Manifest string `json:"manifest,omitempty"`
	// Kind è UnitNode o UnitStatic.
	Kind string `json:"kind"`
	// Tool è lo strumento di sviluppo (vite, next, …); vuoto se non riconosciuto.
	Tool string `json:"tool,omitempty"`
	// Framework è la libreria UI (react, vue, svelte, …); vuoto se non riconosciuta.
	Framework      string `json:"framework,omitempty"`
	PackageManager string `json:"packageManager,omitempty"`
	// PackageManagerSource spiega perché è stato scelto: "packageManager", "lockfile" o "default".
	PackageManagerSource string `json:"packageManagerSource,omitempty"`
	// Lockfile è vero se esiste il lockfile del package manager (tra Dir e la radice): l'installazione
	// allora lo rispetta senza riscriverlo.
	Lockfile bool              `json:"lockfile"`
	Scripts  map[string]string `json:"scripts,omitempty"`
	// DevScript è lo script che avvia il dev server; vuoto se il progetto non ne ha.
	DevScript     string `json:"devScript,omitempty"`
	HasTypeScript bool   `json:"hasTypeScript"`
	// DependenciesInstalled è false se ci sono dipendenze dichiarate ma manca node_modules.
	DependenciesInstalled bool `json:"dependenciesInstalled"`
	// EntryHTML è il percorso relativo alla Dir di index.html se esiste (radice del sito statico).
	EntryHTML string `json:"entryHtml,omitempty"`
	// InstallCommand è il comando che installerebbe le dipendenze (mostrato prima di chiedere conferma).
	InstallCommand []string `json:"installCommand,omitempty"`
	// NodeEngine è l'intervallo engines.node dichiarato, solo informativo.
	NodeEngine string `json:"nodeEngine,omitempty"`
	// TestFramework è il test runner con report strutturato: vitest o jest dalle dipendenze, node dallo script test; vuoto se nessuno.
	TestFramework string `json:"testFramework,omitempty"`
}

type packageManifest struct {
	Name            string            `json:"name"`
	PackageManager  string            `json:"packageManager"`
	Scripts         map[string]string `json:"scripts"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
	Engines         map[string]string `json:"engines"`
}

func (p packageManifest) has(name string) bool {
	_, dep := p.Dependencies[name]
	_, dev := p.DevDependencies[name]
	return dep || dev
}

func (p packageManifest) dependencyCount() int { return len(p.Dependencies) + len(p.DevDependencies) }

// Inspect legge il progetto in dir. root è la radice dell'IDE: la ricerca dei lockfile dei monorepo
// sale al massimo fino a lì. Non esegue nulla e non modifica nessun file.
func Inspect(root, dir string) (Info, error) {
	info := Info{Dir: dir, Relative: relativeTo(root, dir), Kind: UnitStatic}
	if index := filepath.Join(dir, "index.html"); isFile(index) {
		info.EntryHTML = "index.html"
	}
	manifestPath := filepath.Join(dir, "package.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return info, nil
		}
		return info, err
	}
	var manifest packageManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return info, &ManifestError{Path: manifestPath, Err: err}
	}
	info.Kind, info.Manifest, info.Name = UnitNode, manifestPath, manifest.Name
	info.Scripts = manifest.Scripts
	info.NodeEngine = manifest.Engines["node"]
	info.HasTypeScript = manifest.has("typescript") || isFile(filepath.Join(dir, "tsconfig.json"))
	info.DependenciesInstalled = manifest.dependencyCount() == 0 || isDir(filepath.Join(dir, "node_modules"))
	info.PackageManager, info.PackageManagerSource = detectPackageManager(root, dir, manifest.PackageManager)
	info.Lockfile = lockfileFor(root, dir, info.PackageManager)
	info.InstallCommand = append([]string{info.PackageManager}, InstallArguments(info)...)
	info.DevScript = pickDevScript(manifest.Scripts)
	info.Tool = detectTool(manifest, manifest.Scripts[info.DevScript])
	info.Framework = detectFramework(manifest)
	info.TestFramework = detectTestFramework(manifest)
	return info, nil
}

// ManifestError segnala un package.json illeggibile: l'IDE lo mostra senza bloccare il progetto.
type ManifestError struct {
	Path string
	Err  error
}

func (e *ManifestError) Error() string {
	return "invalid " + filepath.Base(e.Path) + ": " + e.Err.Error()
}
func (e *ManifestError) Unwrap() error { return e.Err }

func pickDevScript(scripts map[string]string) string {
	for _, name := range devScriptNames {
		if strings.TrimSpace(scripts[name]) != "" {
			return name
		}
	}
	return ""
}

var toolPatterns = []struct {
	tool    string
	pattern *regexp.Regexp
}{
	{ToolVite, regexp.MustCompile(`(^|[\s;&|])vite(\s|$)`)},
	{ToolNext, regexp.MustCompile(`(^|[\s;&|])next\s+dev`)},
	{ToolCRA, regexp.MustCompile(`react-scripts\s+start`)},
	{ToolAngular, regexp.MustCompile(`(^|[\s;&|])ng\s+serve`)},
	{ToolAstro, regexp.MustCompile(`(^|[\s;&|])astro\s+dev`)},
	{ToolNuxt, regexp.MustCompile(`(^|[\s;&|])nuxt(i)?\s+dev`)},
	{ToolNest, regexp.MustCompile(`(^|[\s;&|])nest\s+start`)},
	{ToolWebpack, regexp.MustCompile(`webpack(-dev-server|\s+serve|\s+s\b)`)},
}

// detectTool prima guarda il testo dello script (è ciò che verrà davvero eseguito), poi le dipendenze.
func detectTool(manifest packageManifest, script string) string {
	for _, candidate := range toolPatterns {
		if candidate.pattern.MatchString(script) {
			return candidate.tool
		}
	}
	for _, candidate := range []struct{ dependency, tool string }{
		{"next", ToolNext}, {"vite", ToolVite}, {"react-scripts", ToolCRA}, {"@angular/cli", ToolAngular},
		{"astro", ToolAstro}, {"nuxt", ToolNuxt}, {"@nestjs/cli", ToolNest}, {"webpack-dev-server", ToolWebpack},
	} {
		if script != "" && manifest.has(candidate.dependency) {
			return candidate.tool
		}
	}
	return ToolUnknown
}

func detectFramework(manifest packageManifest) string {
	for _, candidate := range []struct{ dependency, framework string }{
		{"next", "react"}, {"react", "react"}, {"preact", "preact"}, {"vue", "vue"}, {"nuxt", "vue"},
		{"svelte", "svelte"}, {"solid-js", "solid"}, {"@angular/core", "angular"}, {"astro", "astro"},
		{"@nestjs/core", "nest"},
	} {
		if manifest.has(candidate.dependency) {
			return candidate.framework
		}
	}
	return ""
}

var lockfiles = []struct{ file, manager string }{
	{"pnpm-lock.yaml", PNPM}, {"yarn.lock", Yarn}, {"bun.lockb", Bun}, {"bun.lock", Bun},
	{"package-lock.json", NPM}, {"npm-shrinkwrap.json", NPM},
}

// detectPackageManager preferisce il campo packageManager del package.json (scelta esplicita),
// poi il lockfile più vicino tra dir e root, infine npm.
func detectPackageManager(root, dir, declared string) (manager, source string) {
	if name, _, _ := strings.Cut(declared, "@"); isPackageManager(name) {
		return name, "packageManager"
	}
	for current := filepath.Clean(dir); ; current = filepath.Dir(current) {
		for _, lock := range lockfiles {
			if isFile(filepath.Join(current, lock.file)) {
				return lock.manager, "lockfile"
			}
		}
		if project.SamePath(current, root) || filepath.Dir(current) == current || project.EnsureWithin(root, filepath.Dir(current)) != nil {
			break
		}
	}
	return NPM, "default"
}

// lockfileFor cerca il lockfile di manager da dir verso root.
func lockfileFor(root, dir, manager string) bool {
	for current := filepath.Clean(dir); ; current = filepath.Dir(current) {
		for _, lock := range lockfiles {
			if lock.manager == manager && isFile(filepath.Join(current, lock.file)) {
				return true
			}
		}
		if project.SamePath(current, root) || filepath.Dir(current) == current || project.EnsureWithin(root, filepath.Dir(current)) != nil {
			return false
		}
	}
}

func isPackageManager(name string) bool {
	return name == NPM || name == PNPM || name == Yarn || name == Bun
}

// RunScriptArguments sono gli argomenti per eseguire uno script con il package manager; extra va
// passato allo script (npm vuole il separatore "--", gli altri inoltrano i flag dopo il nome).
func RunScriptArguments(manager, script string, extra []string) []string {
	arguments := []string{"run", script}
	if len(extra) == 0 {
		return arguments
	}
	if manager == NPM {
		arguments = append(arguments, "--")
	}
	return append(arguments, extra...)
}

// InstallArguments sono gli argomenti per installare le dipendenze. Con un lockfile si usa la
// variante "congelata": installa esattamente ciò che il lockfile descrive e non lo riscrive.
func InstallArguments(info Info) []string {
	if !info.Lockfile {
		return []string{"install"}
	}
	switch info.PackageManager {
	case PNPM:
		return []string{"install", "--frozen-lockfile"}
	case Bun:
		return []string{"install", "--frozen-lockfile"}
	case Yarn:
		if isFile(filepath.Join(info.Dir, ".yarnrc.yml")) {
			return []string{"install", "--immutable"}
		}
		return []string{"install", "--frozen-lockfile"}
	}
	return []string{"ci"}
}

// compoundScript è vero per script composti: i flag aggiunti in coda andrebbero all'ultimo comando.
var compoundScript = regexp.MustCompile(`&&|\|\||;|\||concurrently|npm-run-all|run-p|run-s|cross-env`)

// DevServerArguments sono i flag extra che tengono il server sul solo 127.0.0.1. Solo per script
// semplici di strumenti noti: a un comando sconosciuto non si aggiungono opzioni.
func DevServerArguments(info Info) []string {
	script := strings.TrimSpace(info.Scripts[info.DevScript])
	if script == "" || compoundScript.MatchString(script) {
		return nil
	}
	switch info.Tool {
	case ToolVite:
		return []string{"--host", "127.0.0.1"}
	case ToolNext:
		return []string{"-H", "127.0.0.1"}
	}
	return nil
}

// DefaultPort è la porta predefinita dello strumento, usata come punto di partenza per scegliere
// una porta libera; 0 se lo strumento sceglie da solo.
func DefaultPort(tool string) int {
	switch tool {
	case ToolVite:
		return 5173
	case ToolNext, ToolCRA, ToolNuxt, ToolNest:
		return 3000
	case ToolAngular:
		return 4200
	case ToolAstro:
		return 4321
	case ToolWebpack:
		return 8080
	}
	return 3000
}

// DevServerEnvironment sono le variabili che rendono il dev server ospitabile dall'IDE: niente
// browser esterno, solo loopback, output senza colori (più semplice da leggere per il rilevamento).
func DevServerEnvironment(info Info, port int) map[string]string {
	environment := map[string]string{"BROWSER": "none", "HOST": "127.0.0.1", "NO_COLOR": "1", "FORCE_COLOR": "0"}
	if port > 0 && info.Tool != ToolVite {
		environment["PORT"] = strconv.Itoa(port)
	}
	return environment
}

func relativeTo(root, dir string) string {
	if root == "" {
		return "."
	}
	relative, err := filepath.Rel(root, dir)
	if err != nil {
		return filepath.ToSlash(dir)
	}
	return filepath.ToSlash(relative)
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// SortInfos ordina i progetti per percorso relativo (radice per prima).
func SortInfos(infos []Info) {
	sort.SliceStable(infos, func(i, j int) bool {
		if (infos[i].Relative == ".") != (infos[j].Relative == ".") {
			return infos[i].Relative == "."
		}
		return infos[i].Relative < infos[j].Relative
	})
}

// detectTestFramework riconosce i runner che producono un report strutturato; vitest ha la precedenza
// perché i progetti Vite che lo usano tengono spesso anche jest-dom o tipi di jest. Il runner integrato
// di Node (`node --test` nello script test) è l'ultima scelta: vale solo se nessun pacchetto lo sostituisce.
func detectTestFramework(manifest packageManifest) string {
	for _, name := range []string{"vitest", "jest"} {
		if manifest.has(name) {
			return name
		}
	}
	if nodeTestScript.MatchString(manifest.Scripts["test"]) {
		return TestNode
	}
	return ""
}
