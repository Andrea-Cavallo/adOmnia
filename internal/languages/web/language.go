// Package web è il language adapter del web frontend dell'IDE di adOmnia: JavaScript/TypeScript
// (JSX/TSX inclusi), HTML, CSS e JSON, più il riconoscimento dei progetti Node.js.
//
// Ogni linguaggio ha il proprio language server standard (typescript-language-server,
// vscode-html-language-server, …): il registry dell'IDE ne ammette uno per linguaggio e sessione,
// quindi qui ci sono quattro adapter piccoli che condividono tabella delle estensioni e detection.
// Dipende dal core (internal/ide/...) e mai dall'host internal/goide.
package web

import (
	"path/filepath"
	"strings"

	"adomnia/internal/ide/language"
)

// ID dei linguaggi, salvati in project.Unit.Language e usati come chiave del language server.
const (
	ScriptID = "typescript" // JavaScript e TypeScript, JSX/TSX inclusi: un solo server li serve tutti
	HTMLID   = "html"
	CSSID    = "css"
	JSONID   = "json"
)

// Tipi di unità web.
const (
	UnitNode   = "node"   // cartella con package.json
	UnitStatic = "static" // cartella con index.html e nessun package.json
)

// kind è la tabella di un linguaggio: nome, estensioni → languageId LSP.
type kind struct {
	id, name   string
	extensions map[string]string
}

// adapter implementa language.Language e language.DocumentSelector per una riga della tabella.
type adapter struct{ kind }

func (a adapter) ID() string   { return a.id }
func (a adapter) Name() string { return a.name }

// DocumentLanguageID restituisce il languageId LSP del file, se appartiene a questo linguaggio.
func (a adapter) DocumentLanguageID(path string) (string, bool) {
	id, ok := a.extensions[strings.ToLower(filepath.Ext(path))]
	return id, ok
}

var kinds = []kind{
	{id: ScriptID, name: "TypeScript", extensions: map[string]string{
		".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascriptreact",
		".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "typescriptreact",
	}},
	{id: HTMLID, name: "HTML", extensions: map[string]string{".html": "html", ".htm": "html"}},
	{id: CSSID, name: "CSS", extensions: map[string]string{".css": "css", ".scss": "scss", ".less": "less"}},
	{id: JSONID, name: "JSON", extensions: map[string]string{".json": "json", ".jsonc": "jsonc"}},
}

// scriptAdapter aggiunge il riconoscimento dei progetti Node.js al linguaggio che li possiede.
type scriptAdapter struct{ adapter }

// htmlAdapter riconosce le cartelle di siti statici (index.html senza package.json).
type htmlAdapter struct{ adapter }

// Languages restituisce gli adapter web da registrare nell'host, nell'ordine di precedenza.
func Languages() []language.Language {
	adapters := make([]language.Language, 0, len(kinds))
	for _, k := range kinds {
		base := adapter{k}
		switch k.id {
		case ScriptID:
			adapters = append(adapters, scriptAdapter{base})
		case HTMLID:
			adapters = append(adapters, htmlAdapter{base})
		default:
			adapters = append(adapters, base)
		}
	}
	return adapters
}
