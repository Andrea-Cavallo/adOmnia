package run

import (
	"adomnia/internal/ide/process"

	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// composeContainer is the part of `docker compose ps --format json` readiness needs.
type composeContainer struct {
	Service  string `json:"Service"`
	State    string `json:"State"`
	Health   string `json:"Health"`
	ExitCode int    `json:"ExitCode"`
}

// parseComposePS reads both output shapes of `docker compose ps --format json`:
// a JSON array (Compose < 2.21) or one object per line (newer releases).
func parseComposePS(output []byte) ([]composeContainer, error) {
	trimmed := bytes.TrimSpace(output)
	if len(trimmed) == 0 {
		return nil, nil
	}
	if trimmed[0] == '[' {
		var list []composeContainer
		err := json.Unmarshal(trimmed, &list)
		return list, err
	}
	var list []composeContainer
	for _, line := range bytes.Split(trimmed, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var item composeContainer
		if err := json.Unmarshal(line, &item); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, nil
}

// composeReadiness: ready when every container runs (healthy, if it has a
// healthcheck) or finished with exit code 0 (init/one-shot containers).
// failed names the first container that will never become ready.
func composeReadiness(containers []composeContainer) (ready bool, waiting []string, failed string) {
	if len(containers) == 0 {
		return false, nil, ""
	}
	for _, c := range containers {
		state, health := strings.ToLower(c.State), strings.ToLower(c.Health)
		switch {
		case health == "unhealthy":
			return false, nil, c.Service + " is unhealthy"
		case state == "exited" || state == "dead":
			if c.ExitCode != 0 {
				return false, nil, fmt.Sprintf("%s exited with code %d", c.Service, c.ExitCode)
			}
		case state == "running" && (health == "" || health == "healthy"):
		default:
			label := c.Service
			if health != "" {
				label += " (" + health + ")"
			} else if state != "" {
				label += " (" + state + ")"
			}
			waiting = append(waiting, label)
		}
	}
	sort.Strings(waiting)
	return len(waiting) == 0, waiting, ""
}

// WaitComposeReady polls the stack started from file until it is ready, a
// container fails, alive reports the `compose up` process gone, or ctx ends.
// progress receives a line whenever the set of containers still waiting changes.
func WaitComposeReady(ctx context.Context, file string, services []string, alive func() bool, progress func(string)) error {
	docker, err := ResolveDocker()
	if err != nil {
		return err
	}
	last := ""
	for {
		probe, cancel := context.WithTimeout(ctx, dockerProbeTimeout)
		command := exec.CommandContext(probe, docker, append([]string{"compose", "-f", file, "ps", "-a", "--format", "json"}, services...)...)
		command.Dir = filepath.Dir(file)
		process.Configure(command, false)
		output, runErr := command.Output()
		cancel()
		if runErr == nil {
			containers, parseErr := parseComposePS(output)
			if parseErr != nil {
				return fmt.Errorf("could not read docker compose ps: %w", parseErr)
			}
			ready, waiting, failed := composeReadiness(containers)
			if failed != "" {
				return fmt.Errorf("%s", failed)
			}
			if ready {
				return nil
			}
			if line := strings.Join(waiting, ", "); line != "" && line != last {
				last = line
				progress("Waiting for " + line + "…")
			}
		}
		if alive != nil && !alive() {
			return fmt.Errorf("docker compose up stopped before the containers were ready")
		}
		select {
		case <-ctx.Done():
			if last != "" {
				return fmt.Errorf("containers not ready in time: %s", last)
			}
			return fmt.Errorf("containers not ready in time")
		case <-time.After(time.Second):
		}
	}
}
