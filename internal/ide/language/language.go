// Package language definisce il contratto dei language adapter e il loro registro.
//
// Il core dell'IDE dipende solo da questo package, mai da un adapter concreto: un linguaggio
// implementa Language più le sole capability che supporta, e il core le scopre per type assertion.
// Le capability si aggiungono qui quando il core ne ha un consumatore reale (vedi
// docs/architecture/ide-multilanguage-refactor.md, piano di migrazione).
package language

import (
	"context"

	"adomnia/internal/ide/dap"
	"adomnia/internal/ide/lsp"
	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
	idetesting "adomnia/internal/ide/testing"
)

// Language è l'unica interfaccia obbligatoria per un language adapter.
type Language interface {
	// ID è stabile e minuscolo (es. "go"); finisce in project.Unit.Language e nei dati persistiti.
	ID() string
	// Name è il nome mostrato all'utente (es. "Go").
	Name() string
}

type Runner = run.Runner
type DebugAdapterProvider = dap.DebugAdapterProvider
type TestRunner = idetesting.TestRunner

// ProjectDetector riconosce le unità di build del linguaggio sotto root.
type ProjectDetector interface {
	DetectUnits(ctx context.Context, root string) ([]project.Unit, error)
}

// DocumentSelector dice quali file appartengono al linguaggio e con quale languageId LSP
// vanno inviati al suo language server (es. "go", "go.mod").
type DocumentSelector interface {
	DocumentLanguageID(path string) (string, bool)
}

// Tipi di utilizzo di un riferimento, mostrati nella vista Usages.
const (
	UsageDeclaration = "declaration"
	UsageWrite       = "write"
	UsageRead        = "read"
	UsageImport      = "import"
)

// UsageClassifier arricchisce i riferimenti LSP con il tipo di utilizzo, leggendo la sintassi del
// file (mai euristiche testuali). Restituisce un valore per posizione: un Usage* o "" se ignoto.
type UsageClassifier interface {
	ClassifyUsages(text string, positions []lsp.Position) []string
}

// DeclarationExtractor estrae il sorgente della dichiarazione che contiene la posizione (con la sua
// documentazione) e la riga 1-based da cui parte; ok è false se la posizione non è in una dichiarazione.
type DeclarationExtractor interface {
	DeclarationSource(text string, at lsp.Position) (code string, startLine int, ok bool)
}

// Capabilities è derivato dalle interfacce implementate: non si dichiara a mano.
type Capabilities struct {
	Debug            bool `json:"debug"`
	Run              bool `json:"run"`
	Tests            bool `json:"tests"`
	ProjectDetection bool `json:"projectDetection"`
	Documents        bool `json:"documents"`
	Usages           bool `json:"usages"`
	Declarations     bool `json:"declarations"`
}

// CapabilitiesOf restituisce le capability effettivamente implementate da l.
func CapabilitiesOf(l Language) Capabilities {
	_, detects := l.(ProjectDetector)
	_, selects := l.(DocumentSelector)
	_, classifies := l.(UsageClassifier)
	_, extracts := l.(DeclarationExtractor)
	_, runs := l.(Runner)
	_, tests := l.(TestRunner)
	_, debugs := l.(DebugAdapterProvider)
	return Capabilities{Debug: debugs, Tests: tests, Run: runs, ProjectDetection: detects, Documents: selects, Usages: classifies, Declarations: extracts}
}

// Info descrive un linguaggio registrato per la UI: identità e capability derivate.
type Info struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Capabilities Capabilities `json:"capabilities"`
}

// InfoOf restituisce la descrizione di l per la UI.
func InfoOf(l Language) Info {
	return Info{ID: l.ID(), Name: l.Name(), Capabilities: CapabilitiesOf(l)}
}
