// Package golang è il language adapter Go dell'IDE di adOmnia (il nome evita la keyword go).
//
// Dipende dal core (internal/ide/...) e mai il contrario: il core scopre le capability Go tramite
// le interfacce di internal/ide/language. Tutto ciò che sa di go, gopls, Delve, go.mod e GOROOT
// converge qui fase dopo fase (docs/architecture/ide-multilanguage-refactor.md).
package golang

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
