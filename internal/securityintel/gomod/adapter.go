// Package gomod è l'adapter Go di adOmnia Security Intelligence.
//
// Risolve i moduli come Go li risolve davvero: la Minimal Version Selection applicata
// al grafo dei moduli, con replace, exclude e go.work. Per la raggiungibilità usa
// govulncheck, che è l'unico strumento a lavorare sui simboli: il motore ne valorizza
// i percorsi di chiamata senza mai leggere l'assenza di percorsi come garanzia di
// sicurezza.
package gomod

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"golang.org/x/mod/modfile"
	"golang.org/x/mod/module"
	"golang.org/x/mod/semver"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel/govuln"
)

// Adapter è l'adapter Go di adOmnia Security Intelligence.
type Adapter struct {
	// GovulncheckExecutable è il percorso di govulncheck. Vuoto: si cerca nel PATH.
	GovulncheckExecutable string
}

// New crea l'adapter Go.
func New() *Adapter { return &Adapter{} }

// Ecosystem implementa securityintel.EcosystemAdapter.
func (*Adapter) Ecosystem() securityintel.Ecosystem { return securityintel.EcosystemGo }

// maxModules limita la risoluzione per modulo, contro grafi patologici.
const maxModules = 20_000

// Discover implementa securityintel.EcosystemAdapter. Trova i go.mod del workspace.
//
// Un go.work non è un'unità da sé: è il contenitore dei moduli del workspace, e sono
// i moduli che si analizzano. I replace del go.work valgono però per tutti, e
// l'adapter li applica.
func (a *Adapter) Discover(ctx context.Context, root string) ([]securityintel.Target, error) {
	manifests, err := findGoMods(root)
	if err != nil {
		return nil, err
	}
	targets := make([]securityintel.Target, 0, len(manifests))
	for _, manifest := range manifests {
		name := readModulePath(manifest)
		if name == "" {
			name = filepath.Base(filepath.Dir(manifest))
		}
		targets = append(targets, securityintel.Target{
			Ecosystem: securityintel.EcosystemGo,
			Root:      filepath.Dir(manifest),
			Manifest:  manifest,
			Name:      name,
		})
	}
	return targets, nil
}

// Resolve implementa securityintel.EcosystemAdapter.
func (a *Adapter) Resolve(ctx context.Context, target securityintel.Target, options securityintel.ResolveOptions) (securityintel.Resolution, error) {
	data, err := os.ReadFile(target.Manifest)
	if err != nil {
		return securityintel.Resolution{}, fmt.Errorf("read %s: %w", filepath.ToSlash(target.Manifest), err)
	}
	parsed, err := modfile.Parse(target.Manifest, data, nil)
	if err != nil {
		return securityintel.Resolution{}, fmt.Errorf("parse %s: %w", filepath.ToSlash(target.Manifest), err)
	}
	resolution := securityintel.Resolution{}

	// Il go.work aggiunge i moduli del workspace e i replace che valgono per tutti.
	workspaceReplaces := map[string]modfile.Replace{}
	if workspace := findGoWork(filepath.Dir(target.Manifest)); workspace != "" {
		if replaces, warnings := readWorkspace(workspace); len(replaces) > 0 {
			for key, value := range replaces {
				workspaceReplaces[key] = value
			}
			resolution.Warnings = append(resolution.Warnings, warnings...)
		}
	}
	mainModule := ""
	if parsed.Module != nil {
		mainModule = parsed.Module.Mod.Path
	}
	localReplaces := map[string]modfile.Replace{}
	for _, replace := range parsed.Replace {
		localReplaces[replace.Old.Path] = *replace
		if replace.Old.Version != "" {
			localReplaces[replace.Old.Path+"@"+replace.Old.Version] = *replace
		}
	}

	seen := map[string]bool{}
	for _, requirement := range parsed.Require {
		path, version := requirement.Mod.Path, requirement.Mod.Version
		// Un modulo sostituito da replace non si risolve con la propria versione: la
		// versione effettiva è quella del replace, che può essere anche locale.
		replaced, isReplaced := lookupReplace(workspaceReplaces, localReplaces, path, version)
		component := securityintel.Component{
			Ecosystem:      securityintel.EcosystemGo,
			Name:           path,
			Version:        version,
			Scope:          securityintel.ScopeCompile,
			Origin:         securityintel.OriginDeclared,
			Exposure:       securityintel.ExposureRuntime,
			Manifest:       target.Manifest,
			Module:         path,
			Direct:         !requirement.Indirect,
			DependencyPath: []string{mainModule, path},
		}
		if requirement.Indirect {
			component.Origin = securityintel.OriginTransitive
		}
		if isReplaced {
			component.Replace = replaced.New.Path
			if replaced.New.Version != "" {
				component.Version = replaced.New.Version
			}
			// Un replace locale non ha versione: si annota la sorgente sostitutiva.
			if replaced.New.Version == "" {
				component.Replace = replaced.New.Path
				component.Version = "0.0.0-replaced"
			}
		}
		if seen[component.Key()] {
			continue
		}
		seen[component.Key()] = true
		result := append(resolution.Components, component)
		resolution.Components = result
		if len(resolution.Components) >= maxModules {
			resolution.Warnings = append(resolution.Warnings, fmt.Sprintf("module graph truncated at %d modules", maxModules))
			break
		}
	}

	// La standard library e la toolchain sono parte del build e possono essere
	// vulnerabili quanto una dipendenza: le si esplicita perché l'utente non pensa
	// di doverle controllare.
	goVersion := ""
	if parsed.Go != nil {
		goVersion = parsed.Go.Version
	}
	if goVersion != "" {
		resolution.Components = append(resolution.Components, securityintel.Component{
			Ecosystem: securityintel.EcosystemGo,
			Name:      govuln.StdlibModulePath,
			Version:   goVersion,
			Scope:     securityintel.ScopeToolchain,
			Origin:    securityintel.OriginToolchain,
			Exposure:  securityintel.ExposureRuntime,
			Manifest:  target.Manifest,
			Module:    govuln.StdlibModulePath,
			Direct:    true,
		})
	}

	// I moduli esclusi non sono nel build, ma un exclude dimenticato spiega perché una
	// versione vulnerabile è ancora presente: lo si riporta.
	for _, excluded := range parsed.Exclude {
		resolution.Warnings = append(resolution.Warnings,
			fmt.Sprintf("%s@%s is excluded from the build: it cannot be selected, check that this is still intended", excluded.Mod.Path, excluded.Mod.Version))
	}

	sort.SliceStable(resolution.Components, func(left, right int) bool {
		return resolution.Components[left].Name < resolution.Components[right].Name
	})
	return resolution, nil
}

// lookupReplace cerca una direttiva replace che sostituisca il modulo. Go applica il
// replace più specifico: esatto su path@version, poi su path.
func lookupReplace(workspace, local map[string]modfile.Replace, path, version string) (modfile.Replace, bool) {
	for _, source := range []map[string]modfile.Replace{workspace, local} {
		if source == nil {
			continue
		}
		if entry, found := source[path+"@"+version]; found {
			return entry, true
		}
		if entry, found := source[path]; found {
			return entry, true
		}
	}
	return modfile.Replace{}, false
}

// readWorkspace legge i replace di un go.work.
func readWorkspace(path string) (map[string]modfile.Replace, []string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, []string{fmt.Sprintf("go.work %s could not be read: %v", filepath.ToSlash(path), err)}
	}
	parsed, err := modfile.ParseWork(path, data, nil)
	if err != nil {
		return nil, []string{fmt.Sprintf("go.work %s could not be parsed: %v", filepath.ToSlash(path), err)}
	}
	replaces := map[string]modfile.Replace{}
	for _, replace := range parsed.Replace {
		replaces[replace.Old.Path] = *replace
		if replace.Old.Version != "" {
			replaces[replace.Old.Path+"@"+replace.Old.Version] = *replace
		}
	}
	return replaces, nil
}

// findGoWork cerca il go.work che governa la cartella, salendo verso la radice.
func findGoWork(directory string) string {
	current := directory
	for range 8 {
		candidate := filepath.Join(current, "go.work")
		if isFile(candidate) {
			return candidate
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return ""
}

// readModulePath legge il path del modulo da un go.mod.
func readModulePath(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	parsed, err := modfile.Parse(path, data, nil)
	if err != nil || parsed.Module == nil {
		return ""
	}
	return parsed.Module.Mod.Path
}

// findGoMods trova i go.mod sotto root, saltando le cartelle generate.
func findGoMods(root string) ([]string, error) {
	var manifests []string
	visited := 0
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && skipDirectory(entry.Name()) {
			return filepath.SkipDir
		}
		visited++
		if visited > 4_000 || len(manifests) >= 200 {
			return filepath.SkipAll
		}
		if manifest := filepath.Join(path, "go.mod"); isFile(manifest) {
			manifests = append(manifests, manifest)
		}
		return nil
	})
	sort.Strings(manifests)
	return manifests, err
}

// skipDirectory dice se una cartella va saltata dalla scoperta dei moduli.
func skipDirectory(name string) bool {
	switch strings.ToLower(name) {
	case ".git", ".idea", ".vscode", "node_modules", "vendor", "bin", "build", "dist",
		"coverage", ".cache", ".venv", "testdata", ".task":
		return true
	}
	return false
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// govulncheckTimeout è il tempo massimo di una scansione di raggiungibilità.
const govulncheckTimeout = 4 * time.Minute

// AnalyzeReachability implementa securityintel.ReachabilityAnalyzer.
//
// Esegue govulncheck in modalità simbolo e traduce i suoi risultati nell'evidenza del
// motore. L'assenza di un percorso di chiamata non è una garanzia: govulncheck non vede
// la riflessione, il caricamento dinamico, il codice nativo o il codice che non compila
// per il contesto di build selezionato, e il motore lo dice.
func (a *Adapter) AnalyzeReachability(ctx context.Context, target securityintel.Target, findings []securityintel.Finding, options securityintel.ResolveOptions) ([]securityintel.Evidence, error) {
	evidence := make([]securityintel.Evidence, len(findings))
	for index := range findings {
		evidence[index] = securityintel.Evidence{
			Method: "none",
			Note:   securityintel.ReachabilityNote(securityintel.ReachabilityUnknown),
		}
	}
	if !options.AllowProcesses {
		return evidence, nil
	}
	executable := a.GovulncheckExecutable
	if executable == "" {
		executable = findGovulncheck()
	}
	if executable == "" {
		return evidence, fmt.Errorf("govulncheck is not installed: install it with go install golang.org/x/vuln/cmd/govulncheck@latest")
	}
	output, err := runGovulncheck(ctx, target.Root, executable, options)
	if err != nil {
		return evidence, err
	}
	report, err := govuln.ParseStream(output)
	if err != nil {
		return evidence, err
	}
	byIdentity := map[string]govuln.Finding{}
	for _, finding := range report.Findings {
		byIdentity[finding.ID] = finding
		for _, alias := range finding.Aliases {
			byIdentity[alias] = finding
		}
	}
	for index := range findings {
		match, found := byIdentity[identityOf(findings[index])]
		if !found {
			evidence[index].Why = unreportedReason(findings[index])
			continue
		}
		evidence[index] = evidenceFromFinding(match)
	}
	return evidence, nil
}

// identityOf è l'identificativo con cui un finding del motore corrisponde a un
// advisory di govulncheck: l'ID della fonte, il CVE o un alias.
func identityOf(finding securityintel.Finding) string {
	if finding.Advisory.ID != "" {
		return finding.Advisory.ID
	}
	return securityintel.CanonicalAdvisoryID(finding.Advisory)
}

// evidenceFromFinding traduce un finding di govulncheck nell'evidenza del motore.
func evidenceFromFinding(finding govuln.Finding) securityintel.Evidence {
	level := securityintel.ReachabilityUnknown
	switch finding.Level {
	case govuln.LevelCalled:
		level = securityintel.ReachabilityCalled
	case govuln.LevelImported:
		level = securityintel.ReachabilityImported
	case govuln.LevelRequired:
		level = securityintel.ReachabilityRequired
	}
	callPaths := make([][]securityintel.CallFrame, 0, len(finding.CallPaths))
	for _, path := range finding.CallPaths {
		frames := make([]securityintel.CallFrame, 0, len(path))
		for _, frame := range path {
			frames = append(frames, securityintel.CallFrame{
				Module: frame.Module, Version: frame.Version, Package: frame.Package,
				Function: frame.Function, Receiver: frame.Receiver, File: frame.File,
				Relative: frame.Relative, Line: frame.Line, Column: frame.Column,
				InProject: frame.InProject,
			})
		}
		callPaths = append(callPaths, frames)
	}
	method := "govulncheck-symbol"
	switch finding.Level {
	case govuln.LevelImported:
		method = "govulncheck-imports"
	case govuln.LevelRequired:
		method = "govulncheck-required"
	}
	return securityintel.Evidence{
		Method:    method,
		Confirmed: finding.Level == govuln.LevelCalled,
		Note:      securityintel.ReachabilityNote(level),
		CallPaths: callPaths,
		Symbols:   finding.Symbols,
		Packages:  finding.Packages,
	}
}

// runGovulncheck esegue govulncheck in modalità JSON.
func runGovulncheck(ctx context.Context, directory, executable string, options securityintel.ResolveOptions) ([]byte, error) {
	runContext, cancel := context.WithTimeout(ctx, govulncheckTimeout)
	defer cancel()
	arguments := []string{"-json"}
	if options.BuildTags != "" {
		arguments = append(arguments, "-tags", options.BuildTags)
	}
	arguments = append(arguments, "./...")
	command := procutil.CommandContext(runContext, executable, arguments...)
	command.Dir = directory
	if len(options.Environment) > 0 {
		command.Env = append(append([]string{}, os.Environ()...), options.Environment...)
		if options.GOOS != "" {
			command.Env = append(command.Env, "GOOS="+options.GOOS)
		}
		if options.GOARCH != "" {
			command.Env = append(command.Env, "GOARCH="+options.GOARCH)
		}
	}
	var stdout, stderr strings.Builder
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	if runContext.Err() != nil {
		return nil, fmt.Errorf("govulncheck timed out after %s", govulncheckTimeout)
	}
	output := []byte(stdout.String())
	// In modalità JSON govulncheck scrive sempre la sezione "config" su stdout, anche quando non riesce a caricare i
	// package (es. compilato con un Go più vecchio di quello del progetto): stdout non vuoto non basta a dire che è andata
	// bene. Un'uscita con errore senza alcun "finding" o "osv" è un fallimento, mai "nessuna vulnerabilità".
	if err != nil && !bytes.Contains(output, []byte(`"finding"`)) && !bytes.Contains(output, []byte(`"osv"`)) {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("govulncheck: %s", strings.TrimPrefix(firstLine(message), "govulncheck: "))
	}
	return output, nil
}

// unreportedReason spiega perché govulncheck, pur avendo girato, non dice nulla su un advisory. Assenza non è prova di
// sicurezza: per questo il livello resta "non analizzato" e cambia solo il motivo mostrato.
func unreportedReason(finding securityintel.Finding) string {
	if strings.HasPrefix(finding.Advisory.ID, "GO-") {
		if finding.Component.Name == "stdlib" {
			return "govulncheck ran and did not flag it: the installed Go already includes the fix"
		}
		return "govulncheck ran and did not flag it: the vulnerable code is not part of the build"
	}
	return "Not in the Go vulnerability database, so govulncheck cannot judge it"
}

// findGovulncheck cerca govulncheck dove `go install` lo mette (GOBIN, poi GOPATH/bin) e solo dopo nel PATH.
// Un govulncheck vecchio può stare prima nel PATH: ricompilarlo con `go install` ne crea uno nuovo altrove e deve vincere
// quello, altrimenti la ricompilazione non servirebbe a niente.
func findGovulncheck() string {
	name := "govulncheck"
	if runtime.GOOS == "windows" {
		name = "govulncheck.exe"
	}
	for _, directory := range goInstallDirectories() {
		candidate := filepath.Join(directory, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	if candidate, err := exec.LookPath(name); err == nil {
		return candidate
	}
	return ""
}

// goInstallDirectories sono le cartelle in cui `go install` scrive i binari.
func goInstallDirectories() []string {
	goEnv := func(name string) string {
		output, err := procutil.Command("go", "env", name).Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(output))
	}
	var directories []string
	if bin := goEnv("GOBIN"); bin != "" {
		directories = append(directories, bin)
	}
	for _, path := range filepath.SplitList(goEnv("GOPATH")) {
		directories = append(directories, filepath.Join(path, "bin"))
	}
	return directories
}

func firstLine(message string) string {
	if index := strings.IndexAny(message, "\r\n"); index >= 0 {
		return message[:index]
	}
	return message
}

// SemverCompatible dice se un aggiornamento da current a fixed è compatibile secondo
// il versioning semantico: cambia solo la patch, la minor o la major.
func SemverCompatible(current, fixed string) string {
	if !semver.IsValid(current) || !semver.IsValid(fixed) {
		return securityintel.CompatibilityUnknown
	}
	if semver.Major(current) != semver.Major(fixed) {
		return securityintel.CompatibilityMajor
	}
	if semver.MajorMinor(current) != semver.MajorMinor(fixed) {
		return securityintel.CompatibilityMinor
	}
	return securityintel.CompatibilityPatch
}

// ModulePathEscaped è il path escapato di un modulo, per costruire i percorsi della
// cache dei moduli.
func ModulePathEscaped(path string) (string, error) {
	return module.EscapePath(path)
}
