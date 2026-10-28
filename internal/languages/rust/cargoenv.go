package rust

import (
	"fmt"
	"hash/fnv"
	"maps"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toml"
)

// RustEnvironment è la configurazione d'ambiente di un progetto Rust letta solo dal filesystem
// (RS-2.5): le variabili d'ambiente e il `.cargo/config.toml` del progetto. Non esegue mai
// cargo/rustc; `[alias]`, `[env]`, `[build].target-dir` e `[target.*]` sono letti staticamente.
type RustEnvironment struct {
	CargoHome  string `json:"cargoHome"`
	RustupHome string `json:"rustupHome"`
	// TargetDir è la target directory dell'utente risolta ("" = default `target/`).
	TargetDir string                  `json:"targetDir"`
	RustFlags string                  `json:"rustFlags"`
	Aliases   map[string]string       `json:"aliases"`
	Env       map[string]string       `json:"env"`
	Targets   map[string]TargetConfig `json:"targets"`
}

// TargetConfig sono i campi `[target.<tripla>]` del `.cargo/config.toml` (runner/linker).
type TargetConfig struct {
	Runner string `json:"runner,omitempty"`
	Linker string `json:"linker,omitempty"`
}

// RustEnvironmentOf legge l'ambiente Rust del progetto (RS-2.5).
func RustEnvironmentOf(projectRoot string) RustEnvironment {
	env := RustEnvironment{
		CargoHome:  cargoHome(),
		RustupHome: rustupHome(),
		TargetDir:  cargoTargetDir(projectRoot),
		RustFlags:  os.Getenv("RUSTFLAGS"),
		Aliases:    map[string]string{},
		Env:        map[string]string{},
		Targets:    map[string]TargetConfig{},
	}
	if document := cargoConfig(projectRoot); document != nil {
		env.Aliases = stringTable(toml.Table(document, "alias"))
		env.Env = stringTable(toml.Table(document, "env"))
		if targets := toml.Table(document, "target"); targets != nil {
			for triple, raw := range targets {
				if cfg, ok := raw.(map[string]any); ok {
					env.Targets[triple] = TargetConfig{
						Runner: toml.String(cfg, "runner"),
						Linker: toml.String(cfg, "linker"),
					}
				}
			}
		}
	}
	return env
}

// cargoConfig legge il `.cargo/config.toml` del progetto (senza rete, senza esecuzione).
func cargoConfig(projectRoot string) map[string]any {
	data, err := readLimited(filepath.Join(projectRoot, ".cargo", "config.toml"), maxManifestBytes)
	if err != nil {
		return nil
	}
	return toml.Parse(data)
}

// cargoTargetDir risolve la target directory dell'utente: `CARGO_TARGET_DIR` (env) > `[build].target-dir`
// (config) > "" (default `target/`). "" significa nessun override.
func cargoTargetDir(projectRoot string) string {
	if dir := os.Getenv("CARGO_TARGET_DIR"); dir != "" {
		return dir
	}
	if document := cargoConfig(projectRoot); document != nil {
		return toml.String(document, "build", "target-dir")
	}
	return ""
}

// rustAnalyzerTargetDir è la target directory dedicata a rust-analyzer (RS-9.2): separata dalla
// `target/` dell'utente per evitare il lock di cargo, sotto la cache dell'utente per workspace
// (hash del percorso). Rispetta `CARGO_TARGET_DIR` impostato dall'utente; la Run e i test usano
// sempre la `target/` dell'utente.
func rustAnalyzerTargetDir(projectRoot string) string {
	if dir := os.Getenv("CARGO_TARGET_DIR"); dir != "" {
		return dir
	}
	managed := managedAnalyzerDir(projectRoot)
	return managed
}

// managedAnalyzerDir è la cartella che adOmnia gestisce per rust-analyzer (RS-9.2/RS-2): sotto la
// cache dell'utente, una per workspace. "" se la cache dell'utente non è disponibile.
func managedAnalyzerDir(projectRoot string) string {
	cache, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(projectRoot))
	return filepath.Join(cache, "adomnia", "rust-analyzer-target", strconv.FormatUint(hash.Sum64(), 16))
}

// managedAnalyzerRoot è la sola cartella sotto cui adOmnia cancella: `<cache utente>/adomnia/rust-analyzer-target`.
func managedAnalyzerRoot() (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("no user cache folder to clean")
	}
	return filepath.Join(cache, "adomnia", "rust-analyzer-target"), nil
}

// AnalyzerCacheDir è la cartella target che adOmnia gestisce per rust-analyzer del progetto; "" se
// non c'è nulla da gestire (l'utente ha scelto `CARGO_TARGET_DIR`: quella cartella è sua e non si
// tocca).
func AnalyzerCacheDir(projectRoot string) string {
	if os.Getenv("CARGO_TARGET_DIR") != "" {
		return ""
	}
	return managedAnalyzerDir(projectRoot)
}

// AnalyzerCacheSize è la dimensione in byte della cartella indicata (0 se manca). Non segue i
// symlink delle cartelle: la cache di cargo non ne crea, e un ciclo non deve bloccare l'IDE.
func AnalyzerCacheSize(dir string) int64 {
	if dir == "" {
		return 0
	}
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil {
			return nil
		}
		if entry.Type().IsRegular() {
			if info, err := entry.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

// CleanAnalyzerCache cancella la cache di rust-analyzer del progetto e restituisce i byte liberati.
// La cartella è quella gestita da adOmnia: con `CARGO_TARGET_DIR` impostato non si cancella nulla,
// perché sarebbe la cartella di build dell'utente (RS-2, RS-M9).
func CleanAnalyzerCache(projectRoot string) (int64, error) {
	dir := AnalyzerCacheDir(projectRoot)
	if dir == "" {
		return 0, fmt.Errorf("rust-analyzer is using CARGO_TARGET_DIR: that folder is yours, adOmnia does not clean it")
	}
	return removeManagedAnalyzerDir(dir)
}

// removeManagedAnalyzerDir cancella solo una cartella dentro managedAnalyzerRoot: un percorso
// costruito altrove non deve poter portare a `os.RemoveAll` su una cartella dell'utente.
func removeManagedAnalyzerDir(dir string) (int64, error) {
	root, err := managedAnalyzerRoot()
	if err != nil {
		return 0, err
	}
	cleaned, err := filepath.Abs(dir)
	if err != nil {
		return 0, err
	}
	rootCleaned, err := filepath.Abs(root)
	if err != nil {
		return 0, err
	}
	prefix := rootCleaned + string(os.PathSeparator)
	if !strings.HasPrefix(strings.ToLower(cleaned), strings.ToLower(prefix)) {
		return 0, fmt.Errorf("refusing to clean %q: it is not adOmnia's rust-analyzer cache", dir)
	}
	info, err := os.Stat(cleaned)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	if !info.IsDir() {
		return 0, fmt.Errorf("refusing to clean %q: it is not a folder", dir)
	}
	size := AnalyzerCacheSize(cleaned)
	if err := os.RemoveAll(cleaned); err != nil {
		return 0, fmt.Errorf("could not clean the rust-analyzer cache: %w", err)
	}
	return size, nil
}

// cargoAliases unisce gli `[alias]` del `.cargo/config.toml` del progetto e di quello dell'unità
// (l'unità vince, come fa cargo risalendo le cartelle). Nessuna esecuzione: solo filesystem.
func cargoAliases(projectRoot, unitRoot string) map[string]string {
	aliases := map[string]string{}
	for _, root := range []string{projectRoot, unitRoot} {
		if root == "" {
			continue
		}
		maps.Copy(aliases, RustEnvironmentOf(root).Aliases)
	}
	return aliases
}

// cargoHome restituisce CARGO_HOME se impostato, altrimenti il default `~/.cargo`.
func cargoHome() string {
	if home := os.Getenv("CARGO_HOME"); home != "" {
		return home
	}
	dir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, ".cargo")
}

// rustupHome restituisce RUSTUP_HOME se impostato, altrimenti il default `~/.rustup`.
func rustupHome() string {
	if home := os.Getenv("RUSTUP_HOME"); home != "" {
		return home
	}
	dir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, ".rustup")
}

// stringTable converte i valori di una tabella TOML in stringhe (i numeri del parser sono già
// stringhe); le chiavi senza valore stringa sono saltate.
func stringTable(table map[string]any) map[string]string {
	if table == nil {
		return map[string]string{}
	}
	result := make(map[string]string, len(table))
	for key, value := range table {
		if text, ok := value.(string); ok {
			result[key] = text
		}
	}
	return result
}
