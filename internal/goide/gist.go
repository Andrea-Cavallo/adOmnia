package goide

import (
	"adomnia/internal/procutil"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func gistArguments(path, description string, public bool) []string {
	arguments := []string{"gist", "create", path}
	if public {
		arguments = append(arguments, "--public")
	}
	if strings.TrimSpace(description) != "" {
		arguments = append(arguments, "--desc", strings.TrimSpace(description))
	}
	return arguments
}

// CreateGist pubblica un singolo file solo su richiesta esplicita dell'utente tramite GitHub CLI.
func (s *Service) CreateGist(sessionID, relativePath, description string, public bool) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	absolute := filepath.Clean(filepath.Join(session.Project.RealPath, filepath.FromSlash(relativePath)))
	if err := ensureWithinRoot(session.Project.RealPath, absolute); err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	if err := ensureWithinRoot(session.Project.RealPath, resolved); err != nil {
		return "", err
	}
	absolute = resolved
	info, err := os.Stat(absolute)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("GitHub Gist accepts a file, not a folder")
	}
	gh, err := exec.LookPath("gh")
	if err != nil {
		return "", fmt.Errorf("GitHub CLI (gh) is required; install it and run gh auth login")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	command := procutil.CommandContext(ctx, gh, gistArguments(absolute, description, public)...)
	command.Dir = session.Project.RealPath
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("create gist: %s", strings.TrimSpace(string(output)))
	}
	url := strings.TrimSpace(string(output))
	if !strings.HasPrefix(url, "https://gist.github.com/") {
		return "", fmt.Errorf("GitHub CLI returned an unexpected response")
	}
	return url, nil
}
