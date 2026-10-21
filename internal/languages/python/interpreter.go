package python

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"adomnia/internal/ide/process"
	"adomnia/internal/ide/sdk"
	"adomnia/internal/procutil"
)

// Interpreter è un interprete Python candidato per un progetto o un'unità.
// La scoperta è statica (solo nomi di file); la versione arriva da un probe limitato che
// l'host esegue solo con il progetto autorizzato (PY-2.2, PY-8.1).
type Interpreter struct {
	Path string `json:"path"`
	// Version è la versione di Python ("" se non sonda).
	Version string `json:"version,omitempty"`
	// Source dice l'origine: "saved" (scelta dell'utente), "project" (ambiente nel progetto),
	// "VIRTUAL_ENV" (ambiente attivato fuori dal progetto) o "PATH".
	Source string `json:"source"`
	// Problem segnala un candidato che non si dovrebbe usare senza sceglierlo esplicitamente.
	Problem string `json:"problem,omitempty"`
	// Packages è ciò che l'interprete ha già installato (pytest, debugpy, basedpyright):
	// valorizzato solo dal probe.
	Packages map[string]bool `json:"packages,omitempty"`
}

// EnvironmentDirectories sono i nomi delle cartelle di ambiente virtuali riconosciute.
var environmentDirectories = []string{".venv", "venv", "env"}

// interpreterProbe è il comando che riporta versione, eseguibile e pacchetti rilevanti in un solo
// avvio: nessun `pip list`, nessuna importazione del progetto.
const interpreterProbe = "import importlib.util,json,sys;print(json.dumps({'version':sys.version.split()[0],'executable':sys.executable,'prefix':sys.prefix,'packages':{'pytest':importlib.util.find_spec('pytest') is not None,'debugpy':importlib.util.find_spec('debugpy') is not None,'basedpyright':importlib.util.find_spec('basedpyright') is not None}}))"

// InterpreterInfo è il risultato del probe: versione, eseguibile reale e strumenti presenti.
type InterpreterInfo struct {
	Version    string          `json:"version"`
	Executable string          `json:"executable"`
	Prefix     string          `json:"prefix"`
	Packages   map[string]bool `json:"packages"`
}

const interpreterProbeTimeout = 6 * time.Second

// probeInterpreter esegue il probe su un interprete; sostituibile nei test.
var probeInterpreter = readInterpreterInfo

// readInterpreterInfo esegue `<binary> -c interpreterProbe` e legge il JSON in risposta.
func readInterpreterInfo(binary string) (InterpreterInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), interpreterProbeTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, binary, "-c", interpreterProbe)
	process.Configure(command, false)
	output, err := command.Output()
	if ctx.Err() != nil {
		return InterpreterInfo{}, fmt.Errorf("%s does not answer a version probe", binary)
	}
	if err != nil {
		return InterpreterInfo{}, err
	}
	var info InterpreterInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return InterpreterInfo{}, fmt.Errorf("unrecognized interpreter probe output")
	}
	return info, nil
}

// isInterpreter è il controllo statico di un eseguibile interprete: file regolare, non alias
// della Microsoft Store (WindowsApps\python.exe si apre sullo Store quando Python manca).
func isInterpreter(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	if runtime.GOOS == "windows" && strings.Contains(strings.ToLower(filepath.ToSlash(path)), "/windowsapps/python") {
		return false
	}
	return true
}

// environmentInterpreter è il percorso dell'interprete dentro una cartella di ambiente.
func environmentInterpreter(directory string) string {
	name := filepath.Join("bin", sdk.ExecutableName("python"))
	if runtime.GOOS == "windows" {
		name = filepath.Join("Scripts", sdk.ExecutableName("python"))
	}
	candidate := filepath.Join(directory, name)
	if isInterpreter(candidate) {
		return candidate
	}
	return ""
}

// DiscoverInterpreters elenca i candidati statici: ambienti da start salendo fino a boundary
// (working directory → radice del progetto), ambiente attivato e interpreti del PATH.
// Non esegue nulla: versioni e pacchetti arrivano dal probe separato.
func DiscoverInterpreters(boundary, start string) []Interpreter {
	var found []Interpreter
	seen := map[string]bool{}
	add := func(path, source, problem string) {
		path = filepath.Clean(path)
		if seen[path] || !isInterpreter(path) {
			return
		}
		seen[path] = true
		found = append(found, Interpreter{Path: path, Source: source, Problem: problem})
	}
	for _, directory := range environmentRoots(boundary, start) {
		if binary := environmentInterpreter(directory); binary != "" {
			add(binary, "project", "")
		}
	}
	if virtual := strings.TrimSpace(os.Getenv("VIRTUAL_ENV")); virtual != "" {
		if binary := environmentInterpreter(virtual); binary != "" {
			problem := ""
			if !within(boundary, virtual) {
				problem = "this environment is activated outside the project: choose it explicitly if it is the right one"
			}
			add(binary, "VIRTUAL_ENV", problem)
		}
	}
	for _, name := range pathInterpreterNames() {
		if binary, err := lookPath(name); err == nil {
			add(binary, "PATH", "")
		}
	}
	return found
}

// environmentRoots sono le cartelle in cui cercare un ambiente: start e i suoi genitori fino a
// boundary incluso (un monorepo può avere l'ambiente in alto), dalla più vicina alla più lontana.
func environmentRoots(boundary, start string) []string {
	var directories []string
	current := filepath.Clean(start)
	for {
		for _, name := range environmentDirectories {
			if directory := filepath.Join(current, name); isDirectory(directory) {
				directories = append(directories, directory)
			}
		}
		if current == filepath.Clean(boundary) {
			break
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return directories
}

// pathInterpreterNames è l'ordine di ricerca nel PATH: python3 prima su Unix, python prima su Windows.
func pathInterpreterNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"python", "python3"}
	}
	return []string{"python3", "python"}
}

// ResolveInterpreter risolve l'interprete di un'unità: scelta esplicita (configurazione),
// scelta salvata, ambiente del progetto, PATH. Non installa e non scarica nulla.
func ResolveInterpreter(root, workingDirectory, explicit string) (Interpreter, error) {
	if explicit != "" {
		if !filepath.IsAbs(explicit) || strings.ContainsAny(explicit, "\x00\r\n") {
			return Interpreter{}, fmt.Errorf("select the absolute path of a Python interpreter")
		}
		if !isInterpreter(explicit) {
			return Interpreter{}, fmt.Errorf("the selected Python interpreter does not exist: choose an installed interpreter")
		}
		return Interpreter{Path: filepath.Clean(explicit), Source: "saved"}, nil
	}
	if saved := ProjectInterpreter(root, workingDirectory); saved != "" && isInterpreter(saved) {
		return Interpreter{Path: filepath.Clean(saved), Source: "saved"}, nil
	}
	for _, candidate := range DiscoverInterpreters(root, workingDirectoryOr(workingDirectory, root)) {
		if candidate.Problem == "" {
			return candidate, nil
		}
	}
	return Interpreter{}, fmt.Errorf("no Python interpreter was found: select one for this project (Python 3 installed or a project environment)")
}

// workingDirectoryOr normalizza la working directory per la scoperta degli ambienti.
func workingDirectoryOr(workingDirectory, root string) string {
	if workingDirectory != "" {
		return workingDirectory
	}
	return root
}

// ProbeInterpreters completa i candidati con versione, eseguibile reale e strumenti presenti.
// Esegue un comando per interprete: chiamarla solo con il progetto autorizzato (PY-8.1).
func ProbeInterpreters(interpreters []Interpreter) []Interpreter {
	for index := range interpreters {
		info, err := probeInterpreter(interpreters[index].Path)
		if err != nil {
			interpreters[index].Problem = "this interpreter does not answer a version probe"
			continue
		}
		interpreters[index].Version = info.Version
		interpreters[index].Packages = info.Packages
	}
	return interpreters
}

// RequiresPython è il vincolo di versione dichiarato dall'unità ("" se non c'è).
func RequiresPython(unitRoot string) string {
	return readManifest(unitRoot).RequiresPython
}

// ProjectPythonSettingsFile tiene la scelta locale dell'interprete per progetto e per unità:
// `.adomnia/python.local.json`, come il JDK di Java, non condiviso via Git perché il percorso
// è di questa macchina (PY-8.2).
const ProjectPythonSettingsFile = ".adomnia/python.local.json"

type projectPythonSettings struct {
	Interpreter string            `json:"interpreter"`
	Units       map[string]string `json:"units,omitempty"`
}

// ProjectInterpreter è l'interprete scelto per l'unità (o il progetto), "" se non c'è scelta.
func ProjectInterpreter(root, unit string) string {
	settings := readProjectPythonSettings(root)
	if unit != "" {
		relative := relativeDirectory(root, unit)
		if selected := settings.Units[relative]; selected != "" {
			return selected
		}
	}
	return settings.Interpreter
}

// SetProjectInterpreter salva la scelta dell'interprete; unit == "" imposta il progetto,
// una stringa vuota azzera la scelta.
func SetProjectInterpreter(root, unit, binary string) error {
	if binary != "" {
		if !filepath.IsAbs(binary) || !isInterpreter(binary) {
			return fmt.Errorf("%q is not a Python interpreter: select an existing python executable", binary)
		}
	}
	path := filepath.Join(root, filepath.FromSlash(ProjectPythonSettingsFile))
	settings := readProjectPythonSettings(root)
	if unit != "" {
		if settings.Units == nil {
			settings.Units = map[string]string{}
		}
		relative := relativeDirectory(root, unit)
		if binary == "" {
			delete(settings.Units, relative)
		} else {
			settings.Units[relative] = binary
		}
	} else {
		settings.Interpreter = binary
	}
	if settings.Interpreter == "" && len(settings.Units) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

func readProjectPythonSettings(root string) projectPythonSettings {
	var settings projectPythonSettings
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(ProjectPythonSettingsFile)))
	if err != nil {
		return settings
	}
	_ = json.Unmarshal(data, &settings)
	return settings
}

// relativeDirectory è il percorso relativo slash di directory rispetto a root; se directory è
// fuori dal progetto resta il percorso completo.
func relativeDirectory(root, directory string) string {
	if relative, err := filepath.Rel(root, directory); err == nil && !strings.HasPrefix(relative, "..") {
		return filepath.ToSlash(relative)
	}
	return filepath.ToSlash(directory)
}

// relativeSlash è l'alias usato dal parser dei test per i sorgenti.
var relativeSlash = relativeDirectory

// within dice se candidate sta dentro root.
func within(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func isDirectory(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// isFile dice se path è un file regolare.
func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// lookPath è sostituibile nei test.
var lookPath = exec.LookPath
