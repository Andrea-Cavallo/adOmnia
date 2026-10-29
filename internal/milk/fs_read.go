package milk

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/airedact"
	"github.com/Andrea-Cavallo/adOmnia/internal/copilot"
)

const (
	maxACPReadBytes = 256 * 1024
	maxACPReadLines = 5000
)

type readTextFileRequest struct {
	SessionID string `json:"sessionId"`
	Path      string `json:"path"`
	Line      int    `json:"line,omitempty"`
	Limit     int    `json:"limit,omitempty"`
}

func (h *handler) readTextFile(ctx context.Context, params jsonv1.RawMessage) (any, error) {
	var request readTextFileRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, errors.New("invalid fs/read_text_file request")
	}
	if request.Line < 0 || request.Limit < 0 {
		return nil, errors.New("line and limit must not be negative")
	}
	root := h.manager.rootForSession(request.SessionID)
	if root == "" {
		return nil, errors.New("file read denied: unknown agent session")
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, errors.New("file read denied: project root is not available")
	}
	resolvedRoot, err = filepath.Abs(resolvedRoot)
	if err != nil {
		return nil, err
	}
	candidate := strings.TrimSpace(request.Path)
	if candidate == "" {
		return nil, errors.New("file path is required")
	}
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(resolvedRoot, candidate)
	}
	candidate, err = filepath.Abs(candidate)
	if err != nil || !pathWithin(resolvedRoot, candidate) {
		return nil, errors.New("file read denied: path is outside the project")
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil || !pathWithin(resolvedRoot, resolved) {
		return nil, errors.New("file read denied: path leaves the project through a symlink")
	}
	relative, err := filepath.Rel(resolvedRoot, resolved)
	if err != nil || copilot.LoadContextFilterFor(resolvedRoot, h.manager.agent.Event == "opencode").Excluded(filepath.ToSlash(relative)) {
		return nil, errors.New("file read denied by the project AI policy")
	}
	info, err := os.Stat(resolved) // #nosec G703 -- resolved path is contained in the authorized project root
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("file read denied: not a regular readable file")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	file, err := os.Open(resolved) // #nosec G304 -- resolved path is contained in the authorized project root
	if err != nil {
		return nil, fmt.Errorf("read project file: %w", err)
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, maxACPReadBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read project file: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	truncated := len(data) > maxACPReadBytes
	if truncated {
		data = data[:maxACPReadBytes]
	}
	text := strings.ToValidUTF8(string(data), "�")
	if strings.ContainsRune(text, '\x00') {
		return nil, errors.New("file read denied: binary file")
	}
	text, lineTruncated := selectFileLines(text, request.Line, request.Limit)
	truncated = truncated || lineTruncated
	return map[string]any{
		"content": airedact.Redact(text),
		"_meta":   map[string]any{"adomnia": map[string]bool{"truncated": truncated}},
	}, nil
}

func pathWithin(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func selectFileLines(text string, line, limit int) (string, bool) {
	if line == 0 && limit == 0 {
		return text, false
	}
	lines := strings.SplitAfter(text, "\n")
	start := 0
	if line > 1 {
		start = line - 1
	}
	if start >= len(lines) {
		return "", true
	}
	end := min(start+maxACPReadLines, len(lines))
	if limit > 0 {
		end = min(start+limit, end)
	}
	return strings.Join(lines[start:end], ""), end < len(lines)
}

func (m *Manager) scopeForSession(sessionID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.scopeBySession[sessionID]
}
