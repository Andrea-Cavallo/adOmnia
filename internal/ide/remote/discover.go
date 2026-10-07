package remote

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf16"

	"adomnia/internal/ide/process"
)

const discoverTimeout = 3 * time.Second

// Discover elenca gli ambienti raggiungibili da questa macchina: distro WSL, host di ~/.ssh/config e
// container Docker in esecuzione. Ogni fonte è opzionale: se uno strumento manca, la sua lista è vuota.
func Discover(ctx context.Context) []Target {
	var targets []Target
	for _, distro := range WSLDistributions(ctx) {
		targets = append(targets, Target{Kind: KindWSL, Name: distro})
	}
	for _, host := range SSHHosts() {
		targets = append(targets, Target{Kind: KindSSH, Name: host})
	}
	for _, container := range Containers(ctx) {
		targets = append(targets, Target{Kind: KindContainer, Name: container})
	}
	return targets
}

// WSLDistributions legge `wsl -l -q` (UTF-16LE). Le distro interne di Docker Desktop sono escluse.
func WSLDistributions(ctx context.Context) []string {
	if runtime.GOOS != "windows" {
		return nil
	}
	wsl, err := exec.LookPath("wsl.exe")
	if err != nil {
		return nil
	}
	output := run(ctx, wsl, "-l", "-q")
	var distros []string
	for _, line := range strings.Split(DecodeWSLOutput(output), "\n") {
		name := strings.TrimSpace(strings.Trim(line, string([]rune{0, 0xFEFF})))
		if name != "" && !strings.HasPrefix(strings.ToLower(name), "docker-desktop") {
			distros = append(distros, name)
		}
	}
	return distros
}

// DecodeWSLOutput converte l'output UTF-16LE di `wsl -l` in stringa.
func DecodeWSLOutput(output []byte) string {
	if len(output) < 2 || len(output)%2 != 0 || output[1] != 0 && !(output[0] == 0xff && output[1] == 0xfe) {
		return string(output) // WSL_UTF8=1 o versioni che scrivono già UTF-8
	}
	units := make([]uint16, 0, len(output)/2)
	for i := 0; i+1 < len(output); i += 2 {
		units = append(units, uint16(output[i])|uint16(output[i+1])<<8)
	}
	return string(utf16.Decode(units))
}

// SSHHosts restituisce gli alias Host di ~/.ssh/config, esclusi i pattern (*, ?, !).
func SSHHosts() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	file, err := os.Open(filepath.Join(home, ".ssh", "config"))
	if err != nil {
		return nil
	}
	defer file.Close()
	return ParseSSHConfigHosts(bufio.NewScanner(file))
}

// ParseSSHConfigHosts estrae gli alias Host da un file in formato ssh_config.
func ParseSSHConfigHosts(scanner *bufio.Scanner) []string {
	seen := map[string]bool{}
	var hosts []string
	for scanner.Scan() {
		fields := strings.Fields(strings.ReplaceAll(scanner.Text(), "=", " "))
		if len(fields) < 2 || !strings.EqualFold(fields[0], "host") {
			continue
		}
		for _, host := range fields[1:] {
			if strings.HasPrefix(host, "#") {
				break
			}
			if strings.ContainsAny(host, "*?!") || seen[host] || !namePattern.MatchString(host) {
				continue
			}
			seen[host] = true
			hosts = append(hosts, host)
		}
	}
	return hosts
}

// Containers elenca i container Docker in esecuzione per nome.
func Containers(ctx context.Context) []string {
	docker, err := exec.LookPath("docker")
	if err != nil {
		return nil
	}
	var names []string
	for _, line := range strings.Split(string(run(ctx, docker, "ps", "--format", "{{.Names}}")), "\n") {
		if name := strings.TrimSpace(line); namePattern.MatchString(name) {
			names = append(names, name)
		}
	}
	return names
}

func run(ctx context.Context, executable string, arguments ...string) []byte {
	ctx, cancel := context.WithTimeout(ctx, discoverTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, executable, arguments...)
	process.Configure(command, false)
	output, err := command.Output()
	if err != nil {
		return nil
	}
	return output
}
