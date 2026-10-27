package remote

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"os/exec"
	"path"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

type PublishedPort struct {
	Container string `json:"container"`
	Host      string `json:"host"`
	Port      string `json:"port"`
}
type ContainerInfo struct {
	Name             string          `json:"name"`
	Image            string          `json:"image"`
	Running          bool            `json:"running"`
	ProjectDirectory string          `json:"projectDirectory,omitempty"`
	Ports            []PublishedPort `json:"ports"`
}
type containerInspection struct {
	Name            string
	Config          struct{ Image string }
	State           struct{ Running bool }
	Mounts          []struct{ Source, Destination string }
	NetworkSettings struct {
		Ports map[string][]struct{ HostIP, HostPort string }
	}
}

func InspectContainer(ctx context.Context, name, localRoot string) (ContainerInfo, error) {
	if !namePattern.MatchString(name) {
		return ContainerInfo{}, fmt.Errorf("invalid container name")
	}
	docker, err := exec.LookPath("docker")
	if err != nil {
		return ContainerInfo{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, discoverTimeout)
	defer cancel()
	cmd := procutil.CommandContext(ctx, docker, "inspect", "--type=container", "--format", "{{json .}}", name)
	process.Configure(cmd, false)
	out, err := cmd.Output()
	if err != nil {
		return ContainerInfo{}, fmt.Errorf("inspect container: %w", err)
	}
	return containerMapping(out, localRoot)
}
func containerMapping(rawJSON []byte, localRoot string) (ContainerInfo, error) {
	var raw containerInspection
	if err := json.Unmarshal(rawJSON, &raw); err != nil {
		return ContainerInfo{}, err
	}
	info := ContainerInfo{Name: strings.TrimPrefix(raw.Name, "/"), Image: raw.Config.Image, Running: raw.State.Running, Ports: []PublishedPort{}}
	root := mountSource(localRoot)
	longest := 0
	for _, mount := range raw.Mounts {
		source := mountSource(mount.Source)
		compareRoot, compareSource := root, source
		if len(source) > 1 && source[1] == ':' {
			compareRoot, compareSource = strings.ToLower(root), strings.ToLower(source)
		}
		if source != "" && (compareRoot == compareSource || strings.HasPrefix(compareRoot, compareSource+"/")) && len(source) > longest {
			info.ProjectDirectory = path.Join(mount.Destination, strings.TrimPrefix(root[len(source):], "/"))
			longest = len(source)
		}
	}
	for container, bindings := range raw.NetworkSettings.Ports {
		for _, binding := range bindings {
			info.Ports = append(info.Ports, PublishedPort{Container: container, Host: binding.HostIP, Port: binding.HostPort})
		}
	}
	sort.Slice(info.Ports, func(i, j int) bool {
		return info.Ports[i].Container+info.Ports[i].Host < info.Ports[j].Container+info.Ports[j].Host
	})
	return info, nil
}
func mountSource(value string) string {
	value = strings.ReplaceAll(value, `\`, "/")
	for _, prefix := range []string{"/run/desktop/mnt/host/", "/host_mnt/", "/mnt/"} {
		if after, ok := strings.CutPrefix(value, prefix); ok {
			rest := after
			if len(rest) > 1 && rest[1] == '/' {
				value = rest[:1] + ":" + rest[1:]
				break
			}
		}
	}
	value = strings.TrimRight(path.Clean(value), "/")
	if len(value) > 1 && value[1] == ':' {
		value = strings.ToLower(value[:1]) + value[1:]
	}
	return value
}
