// Package language definisce il contratto dei language adapter e il loro registro.
//
// Il core dell'IDE dipende solo da questo package, mai da un adapter concreto: un linguaggio
// implementa Language più le sole capability che supporta, e il core le scopre per type assertion.
// Le capability si aggiungono qui quando il core ne ha un consumatore reale (vedi
// docs/architecture/ide-multilanguage-refactor.md, piano di migrazione).
package language

import (
	"context"

	"adomnia/internal/ide/project"
)

// Language è l'unica interfaccia obbligatoria per un language adapter.
type Language interface {
	// ID è stabile e minuscolo (es. "go"); finisce in project.Unit.Language e nei dati persistiti.
	ID() string
	// Name è il nome mostrato all'utente (es. "Go").
	Name() string
}

// ProjectDetector riconosce le unità di build del linguaggio sotto root.
type ProjectDetector interface {
	DetectUnits(ctx context.Context, root string) ([]project.Unit, error)
}

// Capabilities è derivato dalle interfacce implementate: non si dichiara a mano.
type Capabilities struct {
	ProjectDetection bool `json:"projectDetection"`
}

// CapabilitiesOf restituisce le capability effettivamente implementate da l.
func CapabilitiesOf(l Language) Capabilities {
	_, detects := l.(ProjectDetector)
	return Capabilities{ProjectDetection: detects}
}
