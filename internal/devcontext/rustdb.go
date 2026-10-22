package devcontext

import (
	"bytes"
	"sort"
	"strconv"
	"strings"

	"adomnia/internal/ide/toml"
	"adomnia/internal/languages/rust"
)

// detectRustDatabase: i riferimenti a database di un sorgente Rust (sqlx/diesel/sea-orm e stringhe
// di connessione) diventano entità table e datasource, come per Go e le migration SQL. La lettura è
// statica (nessuna esecuzione): il parsing sta nell'adapter.
func detectRustDatabase(rel string, data []byte) []Entity {
	if !bytes.Contains(data, []byte("sqlx")) && !bytes.Contains(data, []byte("table!")) &&
		!bytes.Contains(data, []byte("table_name")) && !bytes.Contains(data, []byte("with_uri_str")) &&
		!bytes.Contains(data, []byte(".connect")) && !bytes.Contains(data, []byte("::open")) {
		return nil
	}
	var out []Entity
	for _, ref := range rust.DatabasesInFile(rel, data) {
		attrs := map[string]string{
			"declFile": rel,
			"declLine": strconv.Itoa(ref.Line),
			"language": "rust",
		}
		src := Source{"rustdb", rel, ref.Line}
		switch ref.Kind {
		case "table":
			out = append(out, entity("table", ref.Name, ref.Name, ConfidenceInferred, attrs, src))
		case "datasource":
			if ds, ok := datasourceFromValue("DATABASE_URL", ref.Name, src); ok {
				out = append(out, ds)
			}
		}
	}
	return out
}

// detectCargoConfig legge `[env] DATABASE_URL = "…"` di `.cargo/config.toml` e produce la
// datasource come farebbe il rilevatore dotenv. La DSN non porta mai la password.
func detectCargoConfig(rel string, data []byte) []Entity {
	env := toml.Table(toml.Parse(data), "env")
	if env == nil {
		return nil
	}
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out []Entity
	for _, key := range keys {
		value, ok := env[key].(string)
		if !ok {
			continue
		}
		src := Source{"cargoconfig", rel, envLine(data, key)}
		if ds, ok := datasourceFromValue(key, value, src); ok {
			out = append(out, ds)
		}
	}
	return out
}

// envLine restituisce la riga 1-based in cui compare la chiave (approssimata: basta per navigare).
func envLine(data []byte, key string) int {
	for i, raw := range strings.Split(string(data), "\n") {
		if strings.Contains(raw, key) {
			return i + 1
		}
	}
	return 0
}
