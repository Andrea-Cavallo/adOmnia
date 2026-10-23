package lsp

// ServerInfo descrive il language server trovato per un linguaggio.
type ServerInfo struct {
	Language  string `json:"language"`
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Binary    string `json:"binary,omitempty"`
	// Source dice dove è stato trovato: "project", "managed" (cartella strumenti di adOmnia), "PATH" o "custom".
	Source string `json:"source,omitempty"`
	Error  string `json:"error,omitempty"`
	// Installable è vero quando il server manca e adOmnia può installarlo (dopo conferma): la UI
	// offre "Install…" solo in questo caso. Lo imposta l'host, non l'adapter.
	Installable bool `json:"installable,omitzero"`
}

// InstallPlan è l'installazione di un language server come un solo comando visibile: l'host lo
// mostra per intero nella conferma, lo esegue nella console Run e non fa altro di nascosto.
type InstallPlan struct {
	// Task identifica l'attività nella status bar; linguaggi che condividono l'installazione condividono il Task.
	Task string `json:"task"`
	// Title è la domanda della conferma (es. "Install the web language servers?").
	Title string `json:"title"`
	// Label è il testo breve dell'attività in corso nella status bar.
	Label string `json:"label"`
	// Note spiega cosa scarica e dove (sempre nella cartella strumenti di adOmnia, mai nel progetto).
	Note string `json:"note"`
	// Command è la riga mostrata all'utente; Executable e Arguments sono ciò che viene eseguito davvero.
	Command    string   `json:"command"`
	Executable string   `json:"-"`
	Arguments  []string `json:"-"`
	// Directory è la cartella di lavoro del comando; Prepare la crea e pulisce prima dell'avvio.
	Directory string       `json:"-"`
	Prepare   func() error `json:"-"`
	// Languages sono i linguaggi serviti da questa installazione: si sbloccano tutti insieme.
	Languages []string `json:"languages"`
}

// ServerProvider è la capability di un linguaggio che ha un language server gestito da adOmnia:
// lo localizza (progetto, cartella strumenti, PATH), costruisce lo ServerSpec e sa installarlo.
// L'host (internal/codestudio) li usa in modo uniforme: niente codice per linguaggio nel core.
type ServerProvider interface {
	LocateServer(root, toolsRoot string) ServerInfo
	ServerSpec(root, toolsRoot string) (ServerSpec, error)
	// InstallPlan restituisce come installare il server, o un errore che spiega perché non si può
	// (es. runtime mancante). Non scarica né esegue nulla.
	InstallPlan(toolsRoot string) (InstallPlan, error)
}
