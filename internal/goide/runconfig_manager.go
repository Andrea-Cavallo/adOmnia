package goide

import (
	"adomnia/internal/ide/run"
	"adomnia/internal/languages/golang"
	"encoding/json"
)

type RunConfigManager struct{ core *run.Manager }

func NewRunConfigManager() *RunConfigManager {
	return &RunConfigManager{core: run.NewManager(func(config run.Configuration) (run.Configuration, error) {
		normalized, err := normalizeConfiguration(fromCoreConfiguration(config))
		if err != nil {
			return run.Configuration{}, err
		}
		return toCoreConfiguration(normalized), nil
	})}
}
func toCoreConfiguration(config RunConfiguration) run.Configuration {
	options, _ := json.Marshal(golang.RunOptions{GoArguments: config.GoArguments, BuildTags: config.BuildTags, GOOS: config.GOOS, GOARCH: config.GOARCH, Race: config.Race, Coverage: config.Coverage, Profile: config.Profile, DebugFlags: config.DebugFlags})
	result := run.Configuration{
		Language:         config.Language,
		LanguageOptions:  options,
		ID:               config.ID,
		SessionID:        config.SessionID,
		Name:             config.Name,
		Kind:             run.Kind(config.Kind),
		Target:           config.Target,
		Files:            config.Files,
		BinaryPath:       config.BinaryPath,
		WorkingDirectory: config.WorkingDirectory,
		ProgramArguments: config.ProgramArguments,
		Environment:      nil,
		Docker:           run.DockerOptions(config.Docker),
		EnvFile:          config.EnvFile,
		Port:             config.Port,
		PreRun:           config.PreRun,
		PostRun:          config.PostRun,
		Compound:         config.Compound,
		Shared:           config.Shared,
		Pinned:           config.Pinned,
		RestartOnSave:    config.RestartOnSave,
		RestartPolicy:    config.RestartPolicy,
		Order:            config.Order,
		CreatedAt:        config.CreatedAt,
		UpdatedAt:        config.UpdatedAt,
	}
	for _, entry := range config.Environment {
		result.Environment = append(result.Environment, run.EnvironmentEntry(entry))
	}
	if config.Language != "" && config.Language != golang.ID {
		result.LanguageOptions = append(json.RawMessage(nil), config.LanguageOptions...)
	}
	return result
}
func fromCoreConfiguration(config run.Configuration) RunConfiguration {
	result := RunConfiguration{
		Language:         config.Language,
		LanguageOptions:  config.LanguageOptions,
		ID:               config.ID,
		SessionID:        config.SessionID,
		Name:             config.Name,
		Kind:             RunConfigurationKind(config.Kind),
		Target:           config.Target,
		Files:            config.Files,
		BinaryPath:       config.BinaryPath,
		WorkingDirectory: config.WorkingDirectory,
		ProgramArguments: config.ProgramArguments,
		Environment:      nil,
		Docker:           DockerOptions(config.Docker),
		EnvFile:          config.EnvFile,
		Port:             config.Port,
		PreRun:           config.PreRun,
		PostRun:          config.PostRun,
		Compound:         config.Compound,
		Shared:           config.Shared,
		Pinned:           config.Pinned,
		RestartOnSave:    config.RestartOnSave,
		RestartPolicy:    config.RestartPolicy,
		Order:            config.Order,
		CreatedAt:        config.CreatedAt,
		UpdatedAt:        config.UpdatedAt,
	}
	for _, entry := range config.Environment {
		result.Environment = append(result.Environment, EnvironmentEntry(entry))
	}
	if config.Language == "" || config.Language == golang.ID {
		var options golang.RunOptions
		if json.Unmarshal(config.LanguageOptions, &options) == nil {
			result.GoArguments = options.GoArguments
			result.BuildTags = options.BuildTags
			result.GOOS = options.GOOS
			result.GOARCH = options.GOARCH
			result.Race = options.Race
			result.Coverage = options.Coverage
			result.Profile = options.Profile
			result.DebugFlags = options.DebugFlags
		}
	}
	return result
}
func convertConfigurations(configs []run.Configuration) []RunConfiguration {
	result := make([]RunConfiguration, 0, len(configs))
	for _, config := range configs {
		result = append(result, fromCoreConfiguration(config))
	}
	return result
}
func (m *RunConfigManager) List(id SessionID) []RunConfiguration {
	return convertConfigurations(m.core.List(id))
}
func (m *RunConfigManager) Get(id SessionID, key string) (RunConfiguration, error) {
	config, err := m.core.Get(id, key)
	return fromCoreConfiguration(config), err
}
func (m *RunConfigManager) Save(id SessionID, config RunConfiguration) (RunConfiguration, error) {
	normalized, err := normalizeConfiguration(config)
	if err != nil {
		return RunConfiguration{}, err
	}
	saved, err := m.core.Save(id, toCoreConfiguration(normalized))
	return fromCoreConfiguration(saved), err
}
func (m *RunConfigManager) Duplicate(id SessionID, key string) (RunConfiguration, error) {
	config, err := m.core.Duplicate(id, key)
	return fromCoreConfiguration(config), err
}
func (m *RunConfigManager) Rename(id SessionID, key, name string) (RunConfiguration, error) {
	config, err := m.core.Rename(id, key, name)
	return fromCoreConfiguration(config), err
}
func (m *RunConfigManager) Reorder(id SessionID, keys []string) ([]RunConfiguration, error) {
	configs, err := m.core.Reorder(id, keys)
	return convertConfigurations(configs), err
}
func (m *RunConfigManager) Delete(id SessionID, key string) error { return m.core.Delete(id, key) }
func (m *RunConfigManager) CloseSession(id SessionID)             { m.core.CloseSession(id) }
func (m *RunConfigManager) Snapshot() []RunConfiguration {
	return convertConfigurations(m.core.Snapshot())
}
func (m *RunConfigManager) Replace(configs []RunConfiguration) {
	converted := make([]run.Configuration, 0, len(configs))
	for _, config := range configs {
		normalized, err := normalizeConfiguration(config)
		if err == nil {
			converted = append(converted, toCoreConfiguration(normalized))
		}
	}
	m.core.Replace(converted)
}
