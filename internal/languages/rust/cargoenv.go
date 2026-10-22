package rust

import (
	"hash/fnv"
	"os"
	"path/filepath"
	"strconv"

	"adomnia/internal/ide/toml"
)

// RustEnvironment è la configurazione d'ambiente di un progetto Rust letta solo dal filesystem
// (RS-2.5): le variabili d'ambiente e il `.cargo/config.toml` del progetto. Non esegue mai
// cargo/rustc; `[alias]`, `[env]`, `[build].target-dir` e `[target.*]` sono letti staticamente.
type RustEnvironment struct {
	CargoHome  string            `json:"cargoHome"`
	RustupHome string            `json:"rustupHome"`
	// TargetDir è la target directory dell'utente risolta ("" = default `target/`).
	TargetDir  string                  `json:"targetDir"`
	RustFlags  string                  `json:"rustFlags"`
	Aliases    map[string]string       `json:"aliases"`
	Env        map[string]string       `json:"env"`
	Targets    map[string]TargetConfig `json:"targets"`
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
	cache, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(projectRoot))
	return filepath.Join(cache, "adomnia", "rust-analyzer-target", strconv.FormatUint(hash.Sum64(), 16))
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
