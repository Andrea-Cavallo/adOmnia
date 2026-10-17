package run

import (
	"bufio"
	"bytes"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const maxEnvFileSize = 256 * 1024

// Sonda su loopback: un listener su 0.0.0.0 la occupa comunque, e Windows Firewall non chiede il permesso.
// PortAvailable fallisce subito se la porta è già occupata, invece di lasciare che il programma crolli al bind.
func PortAvailable(port int) error {
	listener, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return fmt.Errorf("port %d is already in use: close the process using it or choose another", port)
	}
	return listener.Close()
}

// LoadEnvFile legge un file .env confinato al progetto: KEY=VALUE, commenti #, prefisso export, virgolette.
func LoadEnvFile(root, workingDirectory, path string) (map[string]string, error) {
	candidate := filepath.FromSlash(path)
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(workingDirectory, candidate)
	}
	candidate = filepath.Clean(candidate)
	if err := ensureWithinRoot(root, candidate); err != nil {
		return nil, fmt.Errorf("env file outside the project: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(candidate); err == nil {
		if err := ensureWithinRoot(root, resolved); err != nil {
			return nil, fmt.Errorf("env file outside the project: %w", err)
		}
	}
	info, err := os.Stat(candidate)
	if err != nil {
		return nil, fmt.Errorf("env file %s not found", path)
	}
	if info.IsDir() || info.Size() > maxEnvFileSize {
		return nil, fmt.Errorf("env file %s is invalid or larger than 256 KB", path)
	}
	data, err := os.ReadFile(candidate)
	if err != nil {
		return nil, fmt.Errorf("lettura env file %s fallita: %w", path, err)
	}
	return ParseEnvFile(data)
}

func ParseEnvFile(data []byte) (map[string]string, error) {
	values := make(map[string]string)
	scanner := bufio.NewScanner(bytes.NewReader(bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})))
	for number := 1; scanner.Scan(); number++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || !validEnvironmentName(key) {
			return nil, fmt.Errorf("env file, line %d: expected NAME=value", number)
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			quote := value[0]
			value = value[1 : len(value)-1]
			if quote == '"' {
				value = strings.NewReplacer(`\n`, "\n", `\"`, `"`, `\\`, `\`).Replace(value)
			}
		} else if index := strings.Index(value, " #"); index >= 0 {
			value = strings.TrimSpace(value[:index])
		}
		values[key] = value
	}
	return values, scanner.Err()
}
