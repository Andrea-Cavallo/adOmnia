package codestudio

import (
	jsonv1 "encoding/json"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

// normalizeConfiguration valida e ripulisce una configurazione prima di salvarla o avviarla.
func normalizeConfiguration(config RunConfiguration) (RunConfiguration, error) {
	if len(config.LanguageOptions) > 0 && (config.Language == "" || config.Language == golang.ID) && config.GoArguments == nil && config.BuildTags == nil && config.GOOS == "" && config.GOARCH == "" && !config.Race && !config.Coverage && config.Profile == "" && config.DebugFlags == nil {
		var options golang.RunOptions
		if err := json.Unmarshal(config.LanguageOptions, &options); err != nil {
			return RunConfiguration{}, fmt.Errorf("invalid Go options: %w", err)
		}
		config.GoArguments = options.GoArguments
		config.BuildTags = options.BuildTags
		config.GOOS = options.GOOS
		config.GOARCH = options.GOARCH
		config.Race = options.Race
		config.Coverage = options.Coverage
		config.Profile = options.Profile
		config.DebugFlags = options.DebugFlags
	}

	config.Name = strings.TrimSpace(config.Name)
	if config.Name == "" {
		return RunConfiguration{}, fmt.Errorf("the configuration name cannot be empty")
	}
	if config.Kind == "" {
		config.Kind = RunKindPackage
	}
	switch config.Kind {
	case RunKindPackage, RunKindBuild, RunKindTest:
		config.Target = strings.TrimSpace(config.Target)
		if config.Target == "" {
			config.Target = "."
		}
		config.Files = nil
		config.BinaryPath = ""
	case RunKindFiles:
		files := make([]string, 0, len(config.Files))
		for _, file := range config.Files {
			trimmed := strings.TrimSpace(file)
			if trimmed == "" {
				continue
			}
			files = append(files, trimmed)
		}
		config.Files = files
		if err := golang.New().ValidateRunConfiguration(toCoreConfiguration(config)); err != nil {
			return RunConfiguration{}, err
		}
		config.Target = ""
		config.BinaryPath = ""
	case RunKindBinary:
		config.BinaryPath = strings.TrimSpace(config.BinaryPath)
		if config.BinaryPath == "" {
			return RunConfiguration{}, fmt.Errorf("specify the compiled binary to run")
		}
		config.Target = ""
		config.Files = nil
	case RunKindMake, RunKindDockerBuild, RunKindDockerRun, RunKindDockerCompose:
		normalized, err := normalizeToolConfiguration(config)
		if err != nil {
			return RunConfiguration{}, err
		}
		config = normalized
	case RunKindCommand, RunKindGoTool, RunKindCompound:
		normalized, err := normalizeCommandConfiguration(config)
		if err != nil {
			return RunConfiguration{}, err
		}
		config = normalized
	default:
		if config.Language == "" || config.Language == golang.ID {
			return RunConfiguration{}, fmt.Errorf("unsupported configuration type %q", config.Kind)
		}
		if !jsontext.Value(config.LanguageOptions).IsValid() {
			return RunConfiguration{}, fmt.Errorf("invalid language options")
		}
	}
	if config.Kind != RunKindDockerBuild && config.Kind != RunKindDockerRun {
		config.Docker = DockerOptions{}
	}
	config.WorkingDirectory = strings.TrimSpace(config.WorkingDirectory)
	config.GoArguments = trimArguments(config.GoArguments)
	config.ProgramArguments = trimArguments(config.ProgramArguments)
	config.BuildTags = trimArguments(config.BuildTags)
	config, err := normalizeRunParameters(config)
	if err != nil {
		return RunConfiguration{}, err
	}

	seen := make(map[string]struct{}, len(config.Environment))
	environment := make([]EnvironmentEntry, 0, len(config.Environment))
	for _, entry := range config.Environment {
		key := strings.TrimSpace(entry.Key)
		if key == "" {
			continue
		}
		if strings.ContainsAny(key, "=\x00") {
			return RunConfiguration{}, fmt.Errorf("invalid variable name: %q", key)
		}
		if _, duplicate := seen[key]; duplicate {
			return RunConfiguration{}, fmt.Errorf("variabile duplicata: %q", key)
		}
		seen[key] = struct{}{}
		environment = append(environment, EnvironmentEntry{Key: key, Value: entry.Value, Secret: entry.Secret})
	}
	config.Environment = environment
	policy, err := normalizeRestartPolicy(config.RestartPolicy)
	if err != nil {
		return RunConfiguration{}, err
	}
	config.RestartPolicy = policy
	return config, nil
}

// redactConfiguration azzera i valori segreti mantenendo le chiavi dichiarate.
// ponytail: i segreti restano richiesti a runtime; il passaggio a riferimenti
// vault veri va fatto quando Code Studio sarà collegato a internal/vault.
func redactConfiguration(config RunConfiguration) RunConfiguration {
	clone := cloneConfiguration(config)
	for index, entry := range clone.Environment {
		if entry.Secret {
			clone.Environment[index].Value = ""
		}
	}
	for index, entry := range clone.Docker.BuildArgs {
		if entry.Secret {
			clone.Docker.BuildArgs[index].Value = ""
		}
	}
	return clone
}

func cloneConfiguration(config RunConfiguration) RunConfiguration {
	clone := config
	clone.LanguageOptions = append(jsonv1.RawMessage(nil), config.LanguageOptions...)
	clone.Files = append([]string(nil), config.Files...)
	clone.GoArguments = append([]string(nil), config.GoArguments...)
	clone.ProgramArguments = append([]string(nil), config.ProgramArguments...)
	clone.BuildTags = append([]string(nil), config.BuildTags...)
	clone.Environment = append([]EnvironmentEntry(nil), config.Environment...)
	clone.Docker.BuildArgs = append([]EnvironmentEntry(nil), config.Docker.BuildArgs...)
	clone.Docker.Ports = append([]string(nil), config.Docker.Ports...)
	clone.Docker.Volumes = append([]string(nil), config.Docker.Volumes...)
	clone.Compound = append([]string(nil), config.Compound...)
	return clone
}

func trimArguments(values []string) []string {
	trimmed := make([]string, 0, len(values))
	for _, value := range values {
		if candidate := strings.TrimSpace(value); candidate != "" {
			trimmed = append(trimmed, candidate)
		}
	}
	return trimmed
}
