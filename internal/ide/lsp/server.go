package lsp

import "strings"

// ServerSpec descrive come avviare il language server di un linguaggio. Il lifecycle (spawn,
// initialize, riavvio dopo un crash, shutdown) è generico; tutto ciò che è specifico del server
// arriva da qui, prodotto dal language adapter (per Go: gopls).
type ServerSpec struct {
	// Language è l'ID del linguaggio servito (registry), es. "go": un server per linguaggio e sessione.
	Language string
	// Name è il nome del server nei messaggi e nei log (es. "gopls").
	Name        string
	Binary      string
	Arguments   []string
	Version     string
	Environment []string
	// InitializationOptions va in initialize; Configuration risponde a workspace/configuration
	// (rivalutata a ogni richiesta, così le impostazioni possono cambiare a server avviato).
	InitializationOptions any
	Configuration         func() any
	// WatchesFile filtra i file cambiati su disco da notificare al server (nil: nessuno).
	WatchesFile func(path string) bool
	// VirtualDocuments descrive i documenti che il server indirizza con URI non-file (es. jdt:// per le
	// classi di libreria Java): nil se il server restituisce solo file.
	VirtualDocuments *VirtualDocuments
	// TraceEnvironment elenca le variabili d'ambiente che spiegano tempi e comportamento del server
	// (es. GOFLAGS, GOPROXY): l'host le scrive nel log di avvio, con le credenziali negli URL oscurate.
	TraceEnvironment []string
	// DiscoversNestedUnits: il server, ricevuta la sola radice del progetto, trova da sé le unità annidate
	// dei file aperti (gopls: una view per il modulo di ogni file aperto). L'host gli passa quindi solo la
	// radice: dargli ogni unità come workspace folder gli farebbe caricare subito tutti i moduli.
	DiscoversNestedUnits bool
	// PerUnitSpec, quando non è nil, chiede all'host un server per ogni unità del linguaggio: viene
	// chiamata con la radice dell'unità per costruirne la spec, così ogni unità parte con il proprio
	// ambiente (interprete, venv, toolchain). I server per unità guardano una sola cartella: quella
	// dell'unità, non il progetto. L'host la imposta solo se il linguaggio dichiara language.UnitServers.
	PerUnitSpec func(root string) (ServerSpec, error)
	// HiddenCodeActionKinds are code action kinds (and their sub-kinds) the host never offers, e.g. gopls
	// actions that open its web UI through window/showDocument: Code Studio does not open external pages.
	HiddenCodeActionKinds []string
	// ChangeSignatureCommand is the workspace/executeCommand that rewrites a signature and its callers
	// (gopls: "gopls.change_signature"); empty when the server has none.
	ChangeSignatureCommand string
}

// MatchesKind reports whether kind is one of kinds or a sub-kind of one ("source.doc.x" matches "source.doc").
func MatchesKind(kind string, kinds []string) bool {
	for _, prefix := range kinds {
		if kind == prefix || strings.HasPrefix(kind, prefix+".") {
			return true
		}
	}
	return false
}

// VirtualDocuments dice come leggere un documento con URI non-file: l'host lo salva in un file di sola
// lettura (così si apre come ogni file esterno) e lo sincronizza al server con l'URI originale.
type VirtualDocuments struct {
	// Method è la richiesta personalizzata che, dato {"uri": ...}, risponde col testo (es. java/classFileContents).
	Method string
	// RelativePath è il percorso del file salvato, relativo alla cartella dei documenti virtuali.
	RelativePath func(uri string) string
}

// DisplayName è il nome da mostrare nei messaggi, anche se lo spec non lo indica.
func (s ServerSpec) DisplayName() string {
	if s.Name != "" {
		return s.Name
	}
	return "language server"
}
