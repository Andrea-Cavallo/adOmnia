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
type RunTargetResolver = run.TargetResolver
type RunTarget = run.RunTarget
type DebugAdapterProvider = dap.DebugAdapterProvider
type TestRunner = idetesting.TestRunner
type ServerProvider = lsp.ServerProvider

// UnitServers è la capability di un linguaggio il cui language server va avviato una volta per
// unità invece di una volta per progetto. Serve quando l'unità porta con sé il proprio ambiente
// (un interprete o un venv per servizio, una toolchain per modulo): un solo server multi-root
// userebbe l'ambiente di una sola unità e risolverebbe gli import di tutti con quello.
// Il core non nomina linguaggi: lo dichiara l'adapter e l'host gli passa una spec per unità.
type UnitServers interface {
	ServersPerUnit() bool
	// UnitServerSpec retains the workspace root, where machine-local settings live,
	// while configuring the server for one unit's environment.
	UnitServerSpec(projectRoot, unitRoot, toolsRoot string) (lsp.ServerSpec, error)
}

// DirectDependencies elenca i pacchetti dichiarati direttamente da un'unità, nella forma che
// l'ecosistema usa (percorso di modulo Go, nome PyPI normalizzato, coordinate Maven). Serve a chi
// riconosce i servizi esterni del progetto (Database Studio, Docker Lab, Broker Studio) senza
// conoscere i formati dei singoli manifest: è l'adapter a saperlo leggere.
type DirectDependencies interface {
	DirectDependencies(unit project.Unit) []string
}

// ProjectDetector riconosce le unità di build del linguaggio sotto root.
type ProjectDetector interface {
	DetectUnits(ctx context.Context, root string) ([]project.Unit, error)
}

// UnitScanner estende ProjectDetector con la possibilità di condividere una
// sola scansione del disco tra più linguaggi: il registry cammina l'albero una
// volta e passa ogni cartella al visitor di ogni linguaggio.
type UnitScanner interface {
	ProjectDetector
	// NewUnitsVisitor restituisce il visitor che raccoglie le unità sotto root.
	NewUnitsVisitor(root string) project.UnitsVisitor
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
	LanguageServer   bool `json:"languageServer"`
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
	_, serves := l.(ServerProvider)
	return Capabilities{Debug: debugs, Tests: tests, Run: runs, ProjectDetection: detects, Documents: selects, Usages: classifies, Declarations: extracts, LanguageServer: serves}
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
