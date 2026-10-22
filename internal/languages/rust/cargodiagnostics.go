package rust

import (
	"encoding/json"

	"adomnia/internal/ide/run"
)

// cargoDiagnostic è il messaggio JSON di cargo con `--message-format=json-diagnostic-rendered-ansi`:
// il campo `rendered` conserva il testo colorato per la console, i campi strutturati alimentano il
// diagnostico. Le altre ragioni (compiler-artifact, build-finished) non sono diagnostici.
type cargoDiagnostic struct {
	Reason  string `json:"reason"`
	Message struct {
		Code     *struct{ Code string `json:"code"` } `json:"code"`
		Level    string       `json:"level"`
		Message  string       `json:"message"`
		Spans    []cargoSpan  `json:"spans"`
		Children []cargoChild `json:"children"`
		Rendered string       `json:"rendered"`
	} `json:"message"`
}

type cargoSpan struct {
	FileName    string `json:"file_name"`
	LineStart   int    `json:"line_start"`
	ColumnStart int    `json:"column_start"`
	IsPrimary   bool   `json:"is_primary"`
}

type cargoChild struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

// cargoDiagnosticFromLine interpreta una riga dell'output JSON di cargo e restituisce il
// diagnostico in forma neutra (RS-3.3). Le righe non-JSON o non `compiler-message` vengono
// ignorate, mai parsate dal colore.
func cargoDiagnosticFromLine(line string) (run.Diagnostic, bool) {
	var message cargoDiagnostic
	if err := json.Unmarshal([]byte(line), &message); err != nil || message.Reason != "compiler-message" {
		return run.Diagnostic{}, false
	}
	severity := map[string]int{"error": 1, "warning": 2, "note": 3, "help": 4}[message.Message.Level]
	if severity == 0 {
		return run.Diagnostic{}, false
	}
	diagnostic := run.Diagnostic{Severity: severity, Message: message.Message.Message}
	if message.Message.Code != nil {
		diagnostic.Code = message.Message.Code.Code
	}
	for _, span := range message.Message.Spans {
		if span.IsPrimary {
			diagnostic.File = span.FileName
			diagnostic.Line = span.LineStart
			diagnostic.Column = span.ColumnStart
			break
		}
	}
	for _, child := range message.Message.Children {
		if child.Level == "help" && diagnostic.Help == "" {
			diagnostic.Help = child.Message
		}
	}
	return diagnostic, true
}
