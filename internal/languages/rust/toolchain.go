package rust

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toml"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// Toolchain è una toolchain Rust candidata per un progetto o un'unità: il `cargo` che la esegue e
// il canale dichiarato. La scoperta è statica (solo filesystem); versione e host arrivano da un
// probe `rustc -vV` che l'host esegue solo con il progetto autorizzato (RS-2.2).
type Toolchain struct {
	// Cargo è il percorso dell'eseguibile cargo da usare.
	Cargo string `json:"cargo"`
	// Channel è il canale dichiarato (rust-toolchain.toml / rust-toolchain / RUSTUP_TOOLCHAIN),
	// "" se non c'è un canale esplicito.
	Channel string `json:"channel,omitempty"`
	// Source dice l'origine: "saved" (scelta dell'utente), "project" (rust-toolchain del progetto),
	// "RUSTUP_TOOLCHAIN", "PATH".
	Source string `json:"source"`
	// Host è la host triple del probe (`x86_64-pc-windows-msvc`); "" se non sonda.
	Host string `json:"host,omitempty"`
	// Version è la versione di rustc ("" se non sonda).
	Version string `json:"version,omitempty"`
	// Problem segnala un candidato che non si dovrebbe usare senza sceglierlo (probe senza risposta).
	Problem string `json:"problem,omitempty"`
}

// ToolchainChannel legge il canale da `rust-toolchain.toml` ([toolchain] channel) o dal file
// legacy `rust-toolchain`, salendo da unitRoot fino a boundary incluso. Nessuna esecuzione.
func ToolchainChannel(boundary, unitRoot string) string {
	for _, directory := range ancestorRoots(boundary, unitRoot) {
		if data, err := os.ReadFile(filepath.Join(directory, "rust-toolchain.toml")); err == nil {
			if channel := toml.String(toml.Parse(data), "toolchain", "channel"); channel != "" {
				return channel
			}
		}
		if data, err := os.ReadFile(filepath.Join(directory, "rust-toolchain")); err == nil {
			if channel := strings.TrimSpace(string(data)); channel != "" && !strings.HasPrefix(channel, "[") {
				return channel
			}
		}
	}
	return ""
}

// ancestorRoots elenca unitRoot e i suoi genitori fino a boundary incluso, dalla più vicina alla
// più lontana (un monorepo può avere il rust-toolchain in alto).
func ancestorRoots(boundary, start string) []string {
	var directories []string
	current := filepath.Clean(start)
	for {
		directories = append(directories, current)
		// Confronto insensitive al case: su Windows `unitRoot` e `boundary` possono differire per
		// case o forma (8.3 vs lungo) e il ciclo non si fermerebbe mai al boundary.
		if samePath(current, boundary) {
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

// pathCargo è il cargo trovato nel PATH ("" se assente). Sostituibile nei test.
var pathCargo = func() string {
	path, err := exec.LookPath(sdk.ExecutableName("cargo"))
	if err != nil {
		return ""
	}
	return path
}

// DiscoverToolchains elenca i candidati statici: cargo del PATH più il canale dichiarato dal
// progetto. Non esegue nulla: versione e host arrivano dal probe separato.
func DiscoverToolchains(boundary, start string) []Toolchain {
	var found []Toolchain
	channel := ToolchainChannel(boundary, start)
	if cargo := pathCargo(); cargo != "" {
		source := "PATH"
		if channel != "" {
			source = "project"
		}
		found = append(found, Toolchain{Cargo: filepath.Clean(cargo), Channel: channel, Source: source})
	} else if channel != "" {
		// Un canale dichiarato senza cargo nel PATH: la toolchain esiste solo come canale.
		found = append(found, Toolchain{Channel: channel, Source: "project",
			Problem: "the declared toolchain is not available: no cargo in PATH"})
	}
	return found
}

// ResolveToolchain risolve la toolchain di un'unità: scelta esplicita, scelta salvata, progetto
// (rust-toolchain), PATH. Non installa né scarica nulla.
func ResolveToolchain(root, unitRoot, explicit string) (Toolchain, error) {
	if explicit != "" {
		if !isCargoExecutable(explicit) {
			return Toolchain{}, fmt.Errorf("select the path of a cargo executable")
		}
		return Toolchain{Cargo: filepath.Clean(explicit), Channel: ToolchainChannel(root, unitRoot), Source: "saved"}, nil
	}
	if saved := ProjectToolchain(root, unitRoot); saved != "" && isCargoExecutable(saved) {
		return Toolchain{Cargo: filepath.Clean(saved), Channel: ToolchainChannel(root, unitRoot), Source: "saved"}, nil
	}
	for _, candidate := range DiscoverToolchains(root, unitRoot) {
		if candidate.Problem == "" {
			return candidate, nil
		}
	}
	return Toolchain{}, fmt.Errorf("no Rust toolchain was found: install Rust (rustup or cargo) or select a cargo executable for this project")
}

// isCargoExecutable è il controllo statico di un eseguibile cargo: file regolare.
func isCargoExecutable(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// toolchainProbeTimeout è il tempo massimo di un probe (variabile per i test).
var toolchainProbeTimeout = 6 * time.Second

// probeToolchain esegue `rustc -vV`; sostituibile nei test.
var probeToolchain = readToolchainInfo

// readToolchainInfo esegue `<cargo-dir>/rustc -vV` e ne legge host e versione. Un rustc bloccato
// esce con il timeout e l'albero di processi viene terminato (stessa lezione del probe Python).
func readToolchainInfo(cargo string) (host, version string, err error) {
	rustc := filepath.Join(filepath.Dir(cargo), sdk.ExecutableName("rustc"))
	ctx, cancel := context.WithTimeout(context.Background(), toolchainProbeTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, rustc, "-vV")
	process.Configure(command, false)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return "", "", err
	}
	if err := command.Start(); err != nil {
		return "", "", err
	}
	output := make(chan []byte, 1)
	go func() {
		data, _ := io.ReadAll(stdout)
		output <- data
	}()
	select {
	case data := <-output:
		if err := command.Wait(); err != nil {
			return "", "", err
		}
		return parseRustcVerbose(string(data))
	case <-ctx.Done():
		_ = process.TerminateTree(command)
		go func() { <-output; _ = command.Wait() }()
		return "", "", fmt.Errorf("rustc does not answer a version probe")
	}
}

// parseRustcVerbose legge host e versione dall'output di `rustc -vV` (coppie `key: value`).
func parseRustcVerbose(output string) (host, version string, err error) {
	for line := range strings.SplitSeq(output, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "host":
			host = strings.TrimSpace(value)
		case "release":
			version = strings.TrimSpace(value)
		}
	}
	if host == "" {
		return "", "", fmt.Errorf("rustc -vV did not report a host")
	}
	return host, version, nil
}

// ProbeToolchains completa i candidati con host e versione. Esegue un comando per candidato:
// chiamarla solo con il progetto autorizzato (RS-2.2).
func ProbeToolchains(toolchains []Toolchain) []Toolchain {
	for index := range toolchains {
		if toolchains[index].Cargo == "" {
			toolchains[index].Problem = "no cargo executable to probe"
			continue
		}
		host, version, err := probeToolchain(toolchains[index].Cargo)
		if err != nil {
			toolchains[index].Problem = "this toolchain does not answer a rustc probe"
			continue
		}
		toolchains[index].Host = host
		toolchains[index].Version = version
	}
	return toolchains
}

// windowsHostUsesMSVC dice se una host triple Windows è MSVC (e quindi richiede i Build Tools).
func windowsHostUsesMSVC(host string) bool {
	return runtime.GOOS == "windows" && strings.HasSuffix(host, "-msvc")
}

// ProjectRustSettingsFile tiene la scelta locale della toolchain per progetto e per unità:
// `.adomnia/rust.local.json`, non condiviso via Git (RS-0.4).
const ProjectRustSettingsFile = ".adomnia/rust.local.json"

type projectRustSettings struct {
	Cargo string            `json:"cargo"`
	Units map[string]string `json:"units,omitempty"`
	// LowResources disattiva l'analisi pesante di rust-analyzer (proc-macro e build script,
	// RS-9.5): l'opzione "Low resources" del server più pesante dopo JDT LS.
	LowResources bool `json:"lowResources,omitempty"`
}

// ProjectToolchain è il cargo scelto per l'unità (o il progetto), "" se non c'è scelta.
func ProjectToolchain(root, unit string) string {
	settings := readProjectRustSettings(root)
	if unit != "" {
		relative := relativeDirectory(root, unit)
		if selected := settings.Units[relative]; selected != "" {
			return selected
		}
	}
	return settings.Cargo
}

// ProjectLowResources dice se l'analisi pesante di rust-analyzer è disattivata per il progetto
// (RS-9.5). Il valore si rilegge a ogni richiesta di configurazione: cambiare l'opzione e inviare
// `workspace/didChangeConfiguration` basta, senza riavviare il server.
func ProjectLowResources(root string) bool {
	return readProjectRustSettings(root).LowResources
}

// projectRustSettingsMu serializza il read-modify-write di `.adomnia/rust.local.json`: due chiamate
// concorrenti (progetto + unità) altrimenti perdono un aggiornamento.
var projectRustSettingsMu sync.Mutex

// SetProjectToolchain salva la scelta del cargo; unit == "" imposta il progetto, "" azzera.
func SetProjectToolchain(root, unit, cargo string) error {
	if cargo != "" {
		if !filepath.IsAbs(cargo) || !isCargoExecutable(cargo) {
			return fmt.Errorf("%q is not a cargo executable", cargo)
		}
	}
	projectRustSettingsMu.Lock()
	defer projectRustSettingsMu.Unlock()
	path := filepath.Join(root, filepath.FromSlash(ProjectRustSettingsFile))
	// Un file corrotto non viene sovrascritto: si dice all'utente invece di perdere i dati.
	if data, err := os.ReadFile(path); err == nil {
		var check projectRustSettings
		if err := json.Unmarshal(data, &check); err != nil {
			return fmt.Errorf("%s is not valid JSON: fix or delete it, then retry", ProjectRustSettingsFile)
		}
	}
	settings := readProjectRustSettings(root)
	if unit != "" {
		if settings.Units == nil {
			settings.Units = map[string]string{}
		}
		relative := relativeDirectory(root, unit)
		if cargo == "" {
			delete(settings.Units, relative)
		} else {
			settings.Units[relative] = cargo
		}
	} else {
		settings.Cargo = cargo
	}
	if settings.Cargo == "" && len(settings.Units) == 0 && !settings.LowResources {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	data, err := jsonutil.Marshal(settings, jsontext.WithIndent("  "))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// SetProjectLowResources attiva/disattiva l'analisi pesante di rust-analyzer per il progetto
// (RS-9.5, opzione "Low resources"): proc-macro e build script spengono, il resto dell'editor e la
// Run restano attivi. Persiste in `.adomnia/rust.local.json` come la toolchain (additivo, RS-9.3).
func SetProjectLowResources(root string, enabled bool) error {
	projectRustSettingsMu.Lock()
	defer projectRustSettingsMu.Unlock()
	path := filepath.Join(root, filepath.FromSlash(ProjectRustSettingsFile))
	// Un file corrotto non viene sovrascritto: si dice all'utente invece di perdere i dati.
	if data, err := os.ReadFile(path); err == nil {
		var check projectRustSettings
		if err := json.Unmarshal(data, &check); err != nil {
			return fmt.Errorf("%s is not valid JSON: fix or delete it, then retry", ProjectRustSettingsFile)
		}
	}
	settings := readProjectRustSettings(root)
	settings.LowResources = enabled
	if settings.Cargo == "" && len(settings.Units) == 0 && !settings.LowResources {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	data, err := jsonutil.Marshal(settings, jsontext.WithIndent("  "))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

func readProjectRustSettings(root string) projectRustSettings {
	var settings projectRustSettings
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(ProjectRustSettingsFile)))
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
