package rust

import (
	"regexp"
	"strings"
)

// DatabaseRef è un riferimento a un database dichiarato staticamente in un sorgente Rust: una
// tabella usata (sqlx/diesel/sea-orm) oppure una stringa di connessione. Nessuna esecuzione: è una
// lettura dichiarativa come le route (RS-7.3).
type DatabaseRef struct {
	Kind string // "table" oppure "datasource"
	Name string // nome tabella oppure DSN
	Line int
}

var (
	// sqlString è una stringa letterale che inizia con una keyword SQL.
	sqlString = regexp.MustCompile(`(?is)"\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b[^"]*"`)
	// sqlTable è una tabella in FROM/JOIN/INTO/UPDATE (stessa forma del rilevatore Go).
	sqlTable = regexp.MustCompile(`(?i)\b(FROM|JOIN|INTO|UPDATE)\s+("?[A-Za-z_]\w*"?(?:\."?[A-Za-z_]\w*"?)?)(\s*\()?`)
	// sqlNotTables: keyword che non sono tabelle.
	sqlNotTables = map[string]bool{"SET": true, "SELECT": true, "LATERAL": true, "ONLY": true}
	// dieselTable è `table! { nome (pk) { … } }`.
	dieselTable = regexp.MustCompile(`table!\s*\{\s*([A-Za-z_]\w*)`)
	// seaOrmTable è `#[sea_orm(table_name = "nome")]` (o table_name = "…" nel codice).
	seaOrmTable = regexp.MustCompile(`table_name\s*=\s*"([^"]*)"`)
	// connString è una DSN in una chiamata `with_uri_str("…")`, `.connect("…")` o `::open("…")`.
	connString = regexp.MustCompile(`(?:with_uri_str|connect|::open)\s*\(\s*"([a-z][a-z0-9+]*://[^"]*)"`)
)

// DatabasesInFile estrae tabelle e stringhe di connessione da un sorgente Rust. Tollerante: una
// riga non riconosciuta non blocca le altre.
func DatabasesInFile(relativePath string, data []byte) []DatabaseRef {
	source := string(data)
	var refs []DatabaseRef
	seen := map[string]bool{}
	emit := func(kind, name string, offset int) {
		if !seen[kind+":"+name] {
			seen[kind+":"+name] = true
			refs = append(refs, DatabaseRef{Kind: kind, Name: name, Line: lineAt(source, offset)})
		}
	}

	// Tabelle dalle stringhe SQL (sqlx `query!`/`query_as!`/`query_as`, SQL grezzo di diesel).
	for _, loc := range sqlString.FindAllStringIndex(source, -1) {
		for _, m := range sqlTable.FindAllStringSubmatch(source[loc[0]:loc[1]], -1) {
			table := strings.ReplaceAll(m[2], `"`, "")
			if m[3] != "" || sqlNotTables[strings.ToUpper(table)] {
				continue
			}
			emit("table", table, loc[0])
		}
	}

	// Tabelle diesel `table! { … }`.
	for _, loc := range dieselTable.FindAllStringSubmatchIndex(source, -1) {
		emit("table", source[loc[2]:loc[3]], loc[0])
	}

	// Tabelle sea-orm `table_name = "…"`.
	for _, loc := range seaOrmTable.FindAllStringSubmatchIndex(source, -1) {
		emit("table", source[loc[2]:loc[3]], loc[0])
	}

	// Stringhe di connessione.
	for _, loc := range connString.FindAllStringSubmatchIndex(source, -1) {
		emit("datasource", source[loc[2]:loc[3]], loc[0])
	}

	return refs
}

// lineAt restituisce il numero di riga 1-based dell'offset nel sorgente.
func lineAt(source string, offset int) int {
	return strings.Count(source[:offset], "\n") + 1
}
