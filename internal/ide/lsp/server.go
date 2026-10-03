package lsp

// ServerSpec descrive come avviare il language server di un linguaggio. Il lifecycle (spawn,
// initialize, riavvio dopo un crash, shutdown) è generico; tutto ciò che è specifico del server
// arriva da qui, prodotto dal language adapter (per Go: gopls).
type ServerSpec struct {
	// Language è l'ID del linguaggio servito (registry), es. "go": un server per linguaggio e sessione.
	Language string
	// Name è il nome del server nei messaggi e nei log (es. "gopls").
	Name        string
	Binary      string
	Version     string
	Environment []string
	// InitializationOptions va in initialize; Configuration risponde a workspace/configuration
	// (rivalutata a ogni richiesta, così le impostazioni possono cambiare a server avviato).
	InitializationOptions any
	Configuration         func() any
	// WatchesFile filtra i file cambiati su disco da notificare al server (nil: nessuno).
	WatchesFile func(path string) bool
}

// DisplayName è il nome da mostrare nei messaggi, anche se lo spec non lo indica.
func (s ServerSpec) DisplayName() string {
	if s.Name != "" {
		return s.Name
	}
	return "language server"
}
