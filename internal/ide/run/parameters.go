package run

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
)

func NormalizeTaskIDs(self string, ids []string, when string) ([]string, error) {
	out := []string{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || slices.Contains(out, id) {
			continue
		}
		if self != "" && id == self {
			return nil, fmt.Errorf("a configuration cannot run itself %s startup", when)
		}
		out = append(out, id)
	}
	if len(out) > 10 {
		return nil, fmt.Errorf("massimo 10 task %s dell'avvio", when)
	}
	return out, nil
}
func NormalizeParameters(config Configuration) (Configuration, error) {
	config.EnvFile = strings.TrimSpace(config.EnvFile)
	if config.Port < 0 || config.Port > 65535 {
		return config, fmt.Errorf("invalid port: %d", config.Port)
	}
	var err error
	config.PreRun, err = NormalizeTaskIDs(config.ID, config.PreRun, "prima")
	if err != nil {
		return config, err
	}
	config.PostRun, err = NormalizeTaskIDs(config.ID, config.PostRun, "dopo")
	return config, err
}
func ApplyParameters(root, wd string, config Configuration, env map[string]string) error {
	if config.EnvFile != "" {
		fromFile, err := LoadEnvFile(root, wd, config.EnvFile)
		if err != nil {
			return err
		}
		for k, v := range fromFile {
			if _, explicit := env[k]; !explicit {
				env[k] = v
			}
		}
	}
	if config.Port > 0 {
		if err := PortAvailable(config.Port); err != nil {
			return err
		}
		env["PORT"] = strconv.Itoa(config.Port)
	}
	return nil
}
