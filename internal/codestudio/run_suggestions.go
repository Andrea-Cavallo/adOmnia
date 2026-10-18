package codestudio

import (
	"encoding/json"
	"context"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"adomnia/internal/ide/run"
)

// GetRunSuggestions propone configurazioni per ogni unità di build rilevata, qualunque sia il suo
// linguaggio. Una proposta per (unità, azione); quelle già salvate sono marcate Saved.
func (s *Service) GetRunSuggestions(sessionID string) ([]run.Suggestion, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var suggestions []run.Suggestion
	for _, unit := range session.Project.Units {
		adapter, ok := s.workspace.languages.Get(unit.Language)
		if !ok {
			continue
		}
		if provider, ok := adapter.(run.SuggestionProvider); ok {
			suggestions = append(suggestions, provider.Suggest(ctx, session.Project.RealPath, unit)...)
		}
	}
	suggestions = append(suggestions, scriptSuggestions(session.Project.RealPath)...)
	return finalizeSuggestions(session.Project.RealPath, suggestions, s.runConfigs.List(SessionID(sessionID))), nil
}

// finalizeSuggestions imposta la working directory relativa al progetto, elimina i doppioni per ID e
// marca come salvate le proposte equivalenti a una configurazione esistente.
func finalizeSuggestions(projectRoot string, suggestions []run.Suggestion, saved []RunConfiguration) []run.Suggestion {
	seen := make(map[string]bool, len(suggestions))
	result := make([]run.Suggestion, 0, len(suggestions))
	for _, suggestion := range suggestions {
		if seen[suggestion.ID] {
			continue
		}
		seen[suggestion.ID] = true
		relative, err := filepath.Rel(projectRoot, suggestion.UnitRoot)
		if err != nil || strings.HasPrefix(relative, "..") {
			continue
		}
		suggestion.Configuration.WorkingDirectory = filepath.ToSlash(relative)
		for _, config := range saved {
			if config.Kind == RunConfigurationKind(suggestion.Configuration.Kind) && config.Target == suggestion.Configuration.Target &&
				filepath.ToSlash(filepath.Clean(config.WorkingDirectory)) == filepath.ToSlash(filepath.Clean(suggestion.Configuration.WorkingDirectory)) &&
				slices.Equal(config.ProgramArguments, suggestion.Configuration.ProgramArguments) &&
				mainClassOf(config.LanguageOptions) == mainClassOf(suggestion.Configuration.LanguageOptions) {
				suggestion.Saved = true
				break
			}
		}
		result = append(result, suggestion)
	}
	return result
}

// mainClassOf legge `mainClass` dalle LanguageOptions: due configurazioni "main" sono la stessa proposta solo
// se eseguono la stessa classe (vuoto per ogni altro kind).
func mainClassOf(options json.RawMessage) string {
	var parsed struct {
		MainClass string `json:"mainClass"`
	}
	_ = json.Unmarshal(options, &parsed)
	return parsed.MainClass
}
