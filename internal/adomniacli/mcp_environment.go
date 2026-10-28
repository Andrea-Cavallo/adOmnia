package adomniacli

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/collectionfs"
	"github.com/Andrea-Cavallo/adOmnia/internal/requestcontract"
)

var mcpEnvironmentName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

func (s *mcpServer) collectionUpsertEnvironment(requested string, raw jsonv1.RawMessage, merge bool) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", fmt.Errorf("environment is required")
	}
	var environment collectionfs.Environment
	if err := json.Unmarshal(raw, &environment); err != nil {
		return "", fmt.Errorf("invalid environment: %w", err)
	}
	environment.Name = strings.TrimSpace(environment.Name)
	environment.ID = strings.TrimSpace(environment.ID)
	if err := validateMCPEnvironment(environment); err != nil {
		return "", err
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	collection, folder, err := s.loadCollection(requested)
	if err != nil {
		return "", err
	}
	environments, err := readMCPEnvironments(folder)
	if err != nil {
		return "", err
	}
	index, err := findMCPEnvironment(environments, environment)
	if err != nil {
		return "", err
	}
	created := index < 0
	if created {
		if environment.ID == "" {
			environment.ID = "env-" + shortMCPHash(environment.Name)
		}
		environments = append(environments, environment)
	} else {
		current := environments[index]
		environment.ID = current.ID
		if merge {
			environment.Variables = mergeMCPVariables(current.Variables, environment.Variables)
		}
		environments[index] = environment
	}
	if err := saveMCPEnvironments(folder, collection, environments); err != nil {
		return "", err
	}
	return jsonText(map[string]any{
		"collection": folder, "id": environment.ID, "name": environment.Name,
		"created": created, "variableCount": len(environment.Variables),
	})
}

func (s *mcpServer) collectionDeleteEnvironment(requested, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("name is required")
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	collection, folder, err := s.loadCollection(requested)
	if err != nil {
		return "", err
	}
	environments, err := readMCPEnvironments(folder)
	if err != nil {
		return "", err
	}
	found := false
	kept := make([]collectionfs.Environment, 0, len(environments))
	for _, environment := range environments {
		if environment.Name == name {
			found = true
			continue
		}
		kept = append(kept, environment)
	}
	if !found {
		return "", fmt.Errorf("no environment %q in the collection", name)
	}
	if err := saveMCPEnvironments(folder, collection, kept); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"collection": folder, "name": name, "deleted": true})
}

func validateMCPEnvironment(environment collectionfs.Environment) error {
	if !mcpEnvironmentName.MatchString(environment.Name) {
		return fmt.Errorf("environment.name must start with a letter or digit and contain only letters, digits, dot, underscore or hyphen")
	}
	if environment.Private {
		return fmt.Errorf("private environments are not supported in shared folder collections")
	}
	seen := make(map[string]struct{}, len(environment.Variables))
	for index := range environment.Variables {
		variable := &environment.Variables[index]
		variable.Key = strings.TrimSpace(variable.Key)
		if variable.Key == "" || len(variable.Key) > 256 {
			return fmt.Errorf("environment variable keys are required and must be at most 256 characters")
		}
		if _, duplicate := seen[variable.Key]; duplicate {
			return fmt.Errorf("duplicate environment variable %q", variable.Key)
		}
		seen[variable.Key] = struct{}{}
	}
	return nil
}

func findMCPEnvironment(environments []collectionfs.Environment, target collectionfs.Environment) (int, error) {
	byID, byName := -1, -1
	for index, environment := range environments {
		if target.ID != "" && environment.ID == target.ID {
			byID = index
		}
		if environment.Name == target.Name {
			byName = index
		}
	}
	if byID >= 0 && byName >= 0 && byID != byName {
		return -1, fmt.Errorf("environment id and name refer to different environments")
	}
	if byID >= 0 {
		return byID, nil
	}
	if byName >= 0 {
		if target.ID != "" {
			return -1, fmt.Errorf("environment %q already exists with a different id", target.Name)
		}
		return byName, nil
	}
	return -1, nil
}

func mergeMCPVariables(current, updates []requestcontract.Variable) []requestcontract.Variable {
	merged := append([]requestcontract.Variable(nil), current...)
	indexes := make(map[string]int, len(merged))
	for index, variable := range merged {
		indexes[variable.Key] = index
	}
	for _, variable := range updates {
		if index, exists := indexes[variable.Key]; exists {
			merged[index] = variable
			continue
		}
		indexes[variable.Key] = len(merged)
		merged = append(merged, variable)
	}
	return merged
}

func saveMCPEnvironments(folder string, collection collectionfs.Collection, environments []collectionfs.Environment) error {
	return collectionfs.ExportCollection(folder, collection, collectionfs.ExportOptions{
		Environments: environments, PreserveSecretValues: true,
	})
}

func mcpSecretVariableKeys(folder, name string) (map[string]bool, error) {
	data, err := os.ReadFile(filepath.Join(folder, "environments", name+".json"))
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Variables []requestcontract.Variable `json:"variables"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, err
	}
	keys := map[string]bool{}
	for _, variable := range envelope.Variables {
		if variable.Secret {
			keys[variable.Key] = true
		}
	}
	return keys, nil
}
