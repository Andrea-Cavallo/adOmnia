package codestudio

import (
	"context"
	"fmt"
	"strings"
	"time"

	"adomnia/internal/languages/java"
	"adomnia/internal/securityintel"
	mavensecurity "adomnia/internal/securityintel/maven"
)

// pomVersionsTimeout è il tempo massimo di una ricerca delle versioni su Maven Central.
const pomVersionsTimeout = 30 * time.Second

// PomDependencies elenca le coordinate di un pom.xml o di un build.gradle(.kts) con la posizione di riga e colonna delle versioni.
// Lavora sul testo dell'editor (anche non salvato): niente file, niente rete.
func (s *Service) PomDependencies(sessionID, content string) ([]java.PomDependency, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	// Un pom è XML; un build.gradle(.kts) no: lo stesso metodo serve l'editor di entrambi.
	if !strings.HasPrefix(strings.TrimSpace(strings.TrimPrefix(content, string(rune(0xFEFF)))), "<") {
		return java.ParseGradleDependencies([]byte(content))
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

// PomManagedVersion è la versione che il pom non scrive ma eredita; Owner dice da dove arriva ("inherited"
// da un parent o da un BOM importato, "managed" dal dependencyManagement del pom stesso).
type PomManagedVersion struct {
	Version string `json:"version"`
	Owner   string `json:"owner"`
}

// PomManagedVersions risolve parent e BOM con lo stesso resolver di Security Intelligence (offline: usa solo i
// pom nel repository Maven locale): la dipendenza senza `<version>` mostra la versione reale.
func (s *Service) PomManagedVersions(sessionID, relativePath string) (map[string]PomManagedVersion, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	path, err := s.documents.ResolveProjectPath(session.Project, relativePath)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := mavensecurity.New().Resolver.Resolve(ctx, path, securityintel.ResolveOptions{Offline: true, MaxComponents: 2000})
	if err != nil {
		return nil, err
	}
	managed := map[string]PomManagedVersion{}
	for _, component := range result.Components {
		if component.Direct && (component.Origin == securityintel.OriginManaged || component.Origin == securityintel.OriginInherited) {
			managed[component.Name] = PomManagedVersion{Version: component.Version, Owner: string(component.Origin)}
		}
	}
	return managed, nil
}
