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

// PortAvailable fallisce subito se la porta è già occupata, invece di lasciare che il programma crolli al bind.
func PortAvailable(port int) error {
	listener, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return fmt.Errorf("la porta %d è già in uso: chiudi il processo che la occupa o scegline un'altra", port)
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
		return nil, fmt.Errorf("env file fuori dal progetto: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(candidate); err == nil {
		if err := ensureWithinRoot(root, resolved); err != nil {
			return nil, fmt.Errorf("env file fuori dal progetto: %w", err)
		}
	}
	info, err := os.Stat(candidate)
	if err != nil {
		return nil, fmt.Errorf("env file %s non trovato", path)
	}
	if info.IsDir() || info.Size() > maxEnvFileSize {
		return nil, fmt.Errorf("env file %s non valido o più grande di 256 KB", path)
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
			return nil, fmt.Errorf("env file, riga %d: atteso NOME=valore", number)
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
