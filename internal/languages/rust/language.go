// Package rust è il language adapter Rust dell'IDE di adOmnia: rilevamento dei crate Cargo
// (package e workspace), selezione della toolchain e — nei blocchi successivi — run/test/debug e
// rust-analyzer. La detection legge solo i file: mai eseguire build.rs né cargo durante la
// scansione (RS-1.2), esattamente come pom.xml e pyproject.toml.
package rust

import (
	"path/filepath"
	"strings"
)

// ID del linguaggio Rust, salvato in project.Unit.Language.
const ID = "rust"

// Tipi di unità Rust (RS-0.1).
const (
	UnitCargoPackage   = "cargo-package"   // Cargo.toml con [package]: un crate
	UnitCargoWorkspace = "cargo-workspace" // Cargo.toml con [workspace] e senza [package]: workspace virtuale
)

// Language è l'adapter Rust. È un valore senza stato.
type Language struct{}

func New() *Language { return &Language{} }

func (*Language) ID() string   { return ID }
func (*Language) Name() string { return "Rust" }

// DocumentLanguageID riconosce i file del crate: i sorgenti .rs (languageId "rust") e i manifest
// Cargo (languageId "toml", lo stesso selettore che usa l'estensione rust-analyzer per Cargo.toml).
func (*Language) DocumentLanguageID(path string) (string, bool) {
	base := strings.ToLower(filepath.Base(path))
	switch {
	case base == "cargo.toml", base == "cargo.lock":
		return "toml", true
	case strings.HasSuffix(base, ".rs"):
		return ID, true
	}
	return "", false
}
