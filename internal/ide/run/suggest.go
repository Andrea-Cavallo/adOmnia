package run

import (
	"context"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// Suggestion è una configurazione pronta da salvare, proposta per un'unità di build rilevata.
// Il provider lascia Configuration.WorkingDirectory vuoto: lo imposta l'host relativo al progetto.
type Suggestion struct {
	// ID è stabile (lingua|unità|azione): serve a deduplicare e a ricordare cosa è già salvato.
	ID       string `json:"id"`
	Language string `json:"language"`
	// Title è il testo della card, es. "Vite · pnpm run dev".
	Title string `json:"title"`
	// Action è run, test o build.
	Action   string `json:"action"`
	UnitRoot string `json:"unitRoot"`
	// Saved è vero se esiste già una configurazione equivalente nella sessione.
	Saved         bool          `json:"saved"`
	Configuration Configuration `json:"configuration"`
}

// SuggestionProvider è una capability opzionale dell'adapter: propone configurazioni per un'unità.
// Non esegue nulla e non modifica file; projectRoot limita la ricerca di lockfile e wrapper.
type SuggestionProvider interface {
	Suggest(ctx context.Context, projectRoot string, unit project.Unit) []Suggestion
}
