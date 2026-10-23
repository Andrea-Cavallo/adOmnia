package database

import (
	"encoding/json/v2"
	"strings"

	"adomnia/internal/storage"
)

// IsCredentialRef riporta se un riferimento protetto è usato da una credenziale database
// salvata (password o dsn). Quei riferimenti si aprono solo lato Go: il runner delle query
// risolve il segreto, mai il renderer (DB-2.11, requisito DB-2.10).
func IsCredentialRef(ref string) bool {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return false
	}
	raw, err := storage.Get("database", "connections")
	if err != nil {
		return false
	}
	var list []dbConnectionRequest
	if json.Unmarshal(raw, &list) != nil {
		return false
	}
	for _, cfg := range list {
		if strings.TrimSpace(cfg.Password) == ref || strings.TrimSpace(cfg.DSN) == ref {
			return true
		}
	}
	return false
}
