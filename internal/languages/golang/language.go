// Package golang è il language adapter Go dell'IDE di adOmnia (il nome evita la keyword go).
//
// Dipende dal core (internal/ide/...) e mai il contrario: il core scopre le capability Go tramite
// le interfacce di internal/ide/language. Tutto ciò che sa di go, gopls, Delve, go.mod e GOROOT
// converge qui fase dopo fase (docs/architecture/ide-package-rules.md).
package golang

import "github.com/Andrea-Cavallo/adOmnia/internal/ide/language"

// ID del linguaggio Go, salvato in project.Unit.Language.
const ID = "go"

// Tipi di unità Go.
const (
	UnitModule    = "module"    // cartella con go.mod
	UnitWorkspace = "workspace" // go.work nella radice del progetto
	UnitLoose     = "loose"     // cartella con file .go fuori da ogni modulo
)

// Language è l'adapter Go. È un valore senza stato: le dipendenze arriveranno per iniezione.
type Language struct{}

func New() *Language { return &Language{} }

func (*Language) ID() string   { return ID }
func (*Language) Name() string { return "Go" }

// ImplementationDirection implementa language.ImplementationMarkers: gopls risponde a
// `textDocument/implementation` con le interfacce che un tipo concreto implementa e con i tipi che
// implementano un'interfaccia. È la semantica storica dei marcatori I↑/I↓, invariata.
func (*Language) ImplementationDirection(kind int) string {
	switch kind {
	case 11: // Interface: implementata da tipi e metodi
		return language.MarkerImplementedBy
	case 5, 6, 23: // Class, Method, Struct: implementa interfacce
		return language.MarkerImplements
	}
	return ""
}
