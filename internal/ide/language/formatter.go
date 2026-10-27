package language

import "github.com/Andrea-Cavallo/adOmnia/internal/ide/run"

// FormatRequest descrive il documento da formattare con uno strumento esterno. I percorsi sono
// assoluti tranne RelativePath, relativo alla radice del progetto.
type FormatRequest struct {
	Root             string
	WorkingDirectory string
	Path             string
	RelativePath     string
}

// FormatToolProvider è una capability opzionale dell'adapter: formatta il contenuto del documento
// con uno strumento esterno (stdin → stdout) quando il language server non offre
// `textDocument/formatting`. available=false porta il motivo da mostrare all'utente (strumento non
// installato, interprete mancante); nessun download implicito.
type FormatToolProvider interface {
	FormatTool(request FormatRequest) (spec run.CommandSpec, available bool, reason string, err error)
}
