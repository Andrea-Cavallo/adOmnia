package python

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
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
	// Problem segnala un candidato che non si dovrebbe usare senza sceglierlo esplicitamente
	// (ambiente fuori dal progetto, probe senza risposta, versione incompatibile con l'unità).
	Problem string `json:"problem,omitempty"`
	// Architecture è la coppia macchina/bits del probe (`"AMD64 64-bit"`); "" se non sonda.
	Architecture string `json:"architecture,omitempty"`
	// Packages è ciò che l'interprete ha già installato (pytest, debugpy, basedpyright):
	// valorizzato solo dal probe.
	Packages map[string]bool `json:"packages,omitempty"`
}

// EnvironmentDirectories sono i nomi delle cartelle di ambiente virtuali riconosciute.
var environmentDirectories = []string{".venv", "venv", "env"}

// interpreterProbe è il comando che riporta versione, eseguibile, architettura e pacchetti
// rilevanti in un solo avvio: nessun `pip list`, nessuna importazione del progetto.
const interpreterProbe = "import importlib.util,json,platform,struct,sys;print(json.dumps({'version':sys.version.split()[0],'executable':sys.executable,'prefix':sys.prefix,'architecture':(platform.machine() or 'unknown')+' '+str(struct.calcsize('P')*8)+'-bit','packages':{'pytest':importlib.util.find_spec('pytest') is not None,'pytest_cov':importlib.util.find_spec('pytest_cov') is not None,'debugpy':importlib.util.find_spec('debugpy') is not None,'basedpyright':importlib.util.find_spec('basedpyright') is not None,'ruff':importlib.util.find_spec('ruff') is not None,'uvicorn':importlib.util.find_spec('uvicorn') is not None,'flask':importlib.util.find_spec('flask') is not None,'django':importlib.util.find_spec('django') is not None,'pytest_asyncio':importlib.util.find_spec('pytest_asyncio') is not None,'anyio':importlib.util.find_spec('anyio') is not None,'trio':importlib.util.find_spec('trio') is not None}}))"

// InterpreterInfo è il risultato del probe: versione, eseguibile reale, architettura e strumenti presenti.
type InterpreterInfo struct {
	Version      string          `json:"version"`
	Executable   string          `json:"executable"`
	Prefix       string          `json:"prefix"`
	Architecture string          `json:"architecture"`
	Packages     map[string]bool `json:"packages"`
}

// interpreterProbeTimeout è il tempo massimo di un probe: un interprete bloccato non deve
// fermare la lista (variabile per i test, PY-2.6).
var interpreterProbeTimeout = 6 * time.Second

// probeInterpreter esegue il probe su un interprete; sostituibile nei test.
var probeInterpreter = readInterpreterInfo

// readInterpreterInfo esegue `<binary> -c interpreterProbe` e legge il JSON in risposta.
// La lettura non attende la chiusura del tubo: un interprete bloccato — o un suo figlio che
// tiene lo stdout aperto — deve uscire con il timeout, e il suo albero di processi viene
// terminato invece di restare orfano (PY-2.6, rosso→verde `TestProbeTimesOutOnAStuckInterpreter`).
func readInterpreterInfo(binary string) (InterpreterInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), interpreterProbeTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, binary, "-c", interpreterProbe)
	process.Configure(command, false)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return InterpreterInfo{}, err
	}
	if err := command.Start(); err != nil {
		return InterpreterInfo{}, err
	}
	output := make(chan []byte, 1)
	go func() {
		data, _ := io.ReadAll(stdout)
		output <- data
	}()
	select {
	case data := <-output:
		if err := command.Wait(); err != nil {
			return InterpreterInfo{}, err
		}
		var info InterpreterInfo
		if err := json.Unmarshal(data, &info); err != nil {
			return InterpreterInfo{}, fmt.Errorf("unrecognized interpreter probe output")
		}
		return info, nil
	case <-ctx.Done():
		_ = process.TerminateTree(command)
		go func() {
			<-output
			_ = command.Wait()
		}()
		return InterpreterInfo{}, fmt.Errorf("%s does not answer a version probe", binary)
	}
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
// (working directory → radice del progetto), ambiente attivato, ambienti gestiti da uv/Poetry e
// interpreti del PATH. Non esegue nulla: versioni e pacchetti arrivano dal probe separato.
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
	// Ambienti dei gestori esterni (PY-2.1): si leggono solo configurazione e nomi delle cartelle,
	// mai `uv run` o `poetry env info`. Restano espliciti: non vengono scelti in automatico.
	for _, managed := range managedEnvironments(boundary) {
		add(managed.Path, managed.Source, managed.Problem)
	}
	for _, name := range pathInterpreterNames() {
		if binary, err := lookPath(name); err == nil {
			add(binary, "PATH", "")
		}
	}
	return found
}

// managedEnvironments trova gli ambienti creati dai gestori esterni senza eseguirli: la variabile
// esplicita di uv, il percorso Poetry da ambiente o poetry.toml con le cartelle il cui nome inizia
// con il nome del progetto. Un ambiente trovato qui non viene mai scelto implicitamente.
func managedEnvironments(projectRoot string) []Interpreter {
	var managed []Interpreter
	add := func(directory, source string) {
		binary := environmentInterpreter(directory)
		if binary == "" {
			return
		}
		managed = append(managed, Interpreter{
			Path: binary, Source: source,
			Problem: "managed by " + source + ": choose it explicitly if it is the right environment",
		})
	}
	if configured := strings.TrimSpace(os.Getenv("UV_PROJECT_ENVIRONMENT")); configured != "" {
		directory := configured
		if !filepath.IsAbs(directory) {
			directory = filepath.Join(projectRoot, filepath.FromSlash(directory))
		}
		add(directory, "uv")
	}
	for _, directory := range poetryEnvironments(projectRoot) {
		add(directory, "poetry")
	}
	return managed
}

// poetryEnvironments elenca le cartelle di ambienti Poetry del progetto, lette solo dal
// filesystem: `POETRY_VIRTUALENVS_PATH`, `[virtualenvs] path` di poetry.toml, altrimenti la cache
// predefinita della piattaforma. Poetry nomina le cartelle `<progetto>-<hash>-py<versione>`.
func poetryEnvironments(projectRoot string) []string {
	base := poetryVirtualenvsPath(projectRoot)
	if base == "" || !isDirectory(base) {
		return nil
	}
	prefix := poetryProjectPrefix(projectRoot)
	if prefix == "" {
		return nil
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil
	}
	var directories []string
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(strings.ToLower(entry.Name()), prefix) {
			continue
		}
		directories = append(directories, filepath.Join(base, entry.Name()))
	}
	return directories
}

func poetryVirtualenvsPath(projectRoot string) string {
	if configured := strings.TrimSpace(os.Getenv("POETRY_VIRTUALENVS_PATH")); configured != "" {
		return configured
	}
	if data, err := readLimited(filepath.Join(projectRoot, "poetry.toml"), maxManifestBytes); err == nil {
		if configured := tomlString(parseTOML(data), "virtualenvs", "path"); configured != "" {
			if filepath.IsAbs(configured) {
				return configured
			}
			return filepath.Join(projectRoot, filepath.FromSlash(configured))
		}
	}
	switch runtime.GOOS {
	case "windows":
		if local := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); local != "" {
			return filepath.Join(local, "pypoetry", "Cache", "virtualenvs")
		}
	case "darwin":
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, "Library", "Caches", "pypoetry", "virtualenvs")
		}
	default:
		if cache := strings.TrimSpace(os.Getenv("XDG_CACHE_HOME")); cache != "" {
			return filepath.Join(cache, "pypoetry", "virtualenvs")
		}
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, ".cache", "pypoetry", "virtualenvs")
		}
	}
	return ""
}

// poetryProjectPrefix è il nome della cartella del progetto come lo normalizza Poetry: minuscolo,
// caratteri non alfanumerici sostituiti da "-".
func poetryProjectPrefix(projectRoot string) string {
	name := strings.ToLower(filepath.Base(filepath.Clean(projectRoot)))
	var builder strings.Builder
	for _, char := range name {
		if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' {
			builder.WriteRune(char)
		} else {
			builder.WriteByte('-')
		}
	}
	return builder.String()
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

// ProbeInterpreters completa i candidati con versione, eseguibile reale, architettura e strumenti
// presenti. Esegue un comando per interprete: chiamarla solo con il progetto autorizzato (PY-8.1).
func ProbeInterpreters(interpreters []Interpreter) []Interpreter {
	for index := range interpreters {
		info, err := probeInterpreter(interpreters[index].Path)
		if err != nil {
			interpreters[index].Problem = "this interpreter does not answer a version probe"
			continue
		}
		interpreters[index].Version = info.Version
		interpreters[index].Architecture = info.Architecture
		interpreters[index].Packages = info.Packages
	}
	return interpreters
}

// CheckRequiresPython confronta la versione di un interprete con il vincolo `requires-python`
// di un'unità (sottoinsieme PEP 440: `>=`, `>`, `<=`, `<`, `==`, `!=`, `~=`, `===`, combinati con
// la virgola e con `*` nelle clausole `==`/`!=`). Restituisce "" se l'interprete è compatibile o
// se versione o vincolo non sono interpretabili — un vincolo che non si conosce non blocca
// niente (PY-2.1); altrimenti il motivo da mostrare accanto al candidato.
func CheckRequiresPython(version, requires string) string {
	constraint := strings.TrimSpace(requires)
	if constraint == "" {
		return ""
	}
	want, ok := parsePythonVersion(version)
	if !ok {
		return ""
	}
	for _, clause := range strings.Split(constraint, ",") {
		clause = strings.TrimSpace(clause)
		if clause == "" {
			continue
		}
		satisfied, known := clauseSatisfied(want, clause)
		if !known {
			return ""
		}
		if !satisfied {
			return fmt.Sprintf("Python %s does not satisfy this project (requires-python %s)", version, constraint)
		}
	}
	return ""
}

// FlagIncompatible segnala i candidati la cui versione non soddisfa `requires-python` dell'unità:
// restano scegliabili esplicitamente, ma il dialogo mostra il motivo invece di usarli in silenzio.
func FlagIncompatible(interpreters []Interpreter, requires string) []Interpreter {
	if strings.TrimSpace(requires) == "" {
		return interpreters
	}
	for index := range interpreters {
		if interpreters[index].Version == "" {
			continue
		}
		problem := CheckRequiresPython(interpreters[index].Version, requires)
		if problem == "" {
			continue
		}
		if interpreters[index].Problem != "" {
			interpreters[index].Problem += "; "
		}
		interpreters[index].Problem += problem
	}
	return interpreters
}

// parsePythonVersion legge le componenti numeriche di una versione ("3.11.2", "3.13.0rc1"):
// il resto della stringa (pre-release, locale) non cambia il confronto minore/maggiore.
func parsePythonVersion(version string) ([]int, bool) {
	version = strings.TrimSpace(version)
	if version == "" {
		return nil, false
	}
	var parts []int
	for _, component := range strings.Split(version, ".") {
		digits := component
		for len(digits) > 0 && digits[0] >= '0' && digits[0] <= '9' {
			digits = digits[1:]
		}
		number := component[:len(component)-len(digits)]
		if number == "" {
			break
		}
		value, err := strconv.Atoi(number)
		if err != nil {
			return nil, false
		}
		parts = append(parts, value)
	}
	return parts, len(parts) > 0
}

// versionCompare confronta due versioni componente per componente, completando con zeri.
func versionCompare(left, right []int) int {
	for index := 0; index < len(left) || index < len(right); index++ {
		a, b := 0, 0
		if index < len(left) {
			a = left[index]
		}
		if index < len(right) {
			b = right[index]
		}
		if a != b {
			if a < b {
				return -1
			}
			return 1
		}
	}
	return 0
}

// prefixMatch dice se version inizia con prefix (per `==3.11.*`, `~=3.10`).
func prefixMatch(version, prefix []int) bool {
	if len(prefix) > len(version) {
		return false
	}
	for index := range prefix {
		if version[index] != prefix[index] {
			return false
		}
	}
	return true
}

// clauseSatisfied valuta una singola clausola del vincolo. known = false quando la clausola
// non è interpretabile: il chiamante decide, qui si preferisce non bloccare.
func clauseSatisfied(version []int, clause string) (satisfied, known bool) {
	for _, operator := range []string{"===", "==", "!=", ">=", "<=", "~=", ">", "<"} {
		if !strings.HasPrefix(clause, operator) {
			continue
		}
		operand := strings.TrimSpace(clause[len(operator):])
		wildcard := strings.HasSuffix(operand, "*")
		operand = strings.TrimSpace(strings.TrimSuffix(operand, "*"))
		target, ok := parsePythonVersion(operand)
		if !ok {
			return false, false
		}
		comparison := versionCompare(version, target)
		switch operator {
		case "===":
			return comparison == 0, true
		case "==":
			if wildcard {
				return prefixMatch(version, target), true
			}
			return comparison == 0, true
		case "!=":
			if wildcard {
				return !prefixMatch(version, target), true
			}
			return comparison != 0, true
		case ">=":
			return comparison >= 0, true
		case "<=":
			return comparison <= 0, true
		case ">":
			return comparison > 0, true
		case "<":
			return comparison < 0, true
		case "~=":
			// `~=3.10` significa >=3.10 e <4; `~=3.10.1` significa >=3.10.1 e <3.11.
			// Con una sola componente la clausola non è valida PEP 440: non si blocca.
			if len(target) < 2 {
				return false, false
			}
			if !prefixMatch(version, target[:len(target)-1]) {
				return false, true
			}
			upper := append([]int(nil), target[:len(target)-1]...)
			upper[len(upper)-1]++
			return versionCompare(version, target) >= 0 && versionCompare(version, upper) < 0, true
		}
	}
	return false, false
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
