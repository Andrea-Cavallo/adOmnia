package codestudio

import (
	"context"
	"fmt"
	"time"

	"adomnia/internal/languages/java"
)

// pomVersionsTimeout è il tempo massimo di una ricerca delle versioni su Maven Central.
const pomVersionsTimeout = 30 * time.Second

// PomDependencies elenca le coordinate di un pom.xml con la posizione di riga e colonna delle versioni.
// Lavora sul testo dell'editor (anche non salvato): niente file, niente rete.
func (s *Service) PomDependencies(sessionID, content string) ([]java.PomDependency, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	return java.ParsePomDependencies([]byte(content))
}

// PomVersions chiede a Maven Central le versioni stabili di `group:artifact` → versione corrente. È una
// richiesta di rete e parte solo da un'azione esplicita dell'utente ("Check for updates"): esce solo la coordinata.
func (s *Service) PomVersions(sessionID string, current map[string]string) ([]java.VersionInfo, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	if len(current) == 0 {
		return nil, fmt.Errorf("no dependencies to check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), pomVersionsTimeout)
	defer cancel()
	return java.LookupVersions(ctx, current), nil
}
