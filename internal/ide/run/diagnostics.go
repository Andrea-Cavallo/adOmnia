package run

// Diagnostic è un diagnostico di compilazione estratto dall'output di build, in
// forma neutra rispetto al linguaggio: il core non conosce cargo né rustc. La UI
// lo mappa sul pannello Problems come i diagnostici LSP (RS-3.3).
type Diagnostic struct {
	// File è il percorso relativo al progetto, in forma slash.
	File string `json:"file"`
	// Line e Column sono 1-based; Column conta i caratteri (non i byte).
	Line   int `json:"line"`
	Column int `json:"column"`
	// Severity segue l'ordinamento LSP: 1 errore, 2 warning, 3 info, 4 hint.
	Severity int `json:"severity"`
	// Code è il codice del compilatore (es. "E0308"); vuoto se assente.
	Code string `json:"code,omitempty"`
	// Message è il messaggio principale del diagnostico.
	Message string `json:"message"`
	// Help è il suggerimento associato (il testo "help:" di rustc), se presente.
	Help string `json:"help,omitempty"`
}
