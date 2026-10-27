package codestudio

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// formatToolTimeout limita lo strumento esterno: un Ruff bloccato non deve congelare il salvataggio.
const formatToolTimeout = 20 * time.Second

// formatWithLanguageTool è il fallback quando il language server non offre la formattazione
// (basedpyright non la supporta): l'adapter dichiara il comando, l'host lo esegue con il testo del
// buffer su stdin. Un solo proprietario delle modifiche: lo stesso percorso di FormatDocument è
// usato dalla finestra e dal salvataggio automatico (PY-4.5).
func (s *Service) formatWithLanguageTool(ctx context.Context, sessionID, documentID string) (FormatResult, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return FormatResult{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return FormatResult{}, fmt.Errorf("authorize the project to format with an external tool")
	}
	path, languageID, text, version, ok := s.lsp.DocumentSnapshot(SessionID(sessionID), DocumentID(documentID))
	if !ok {
		return FormatResult{}, fmt.Errorf("the document is not open in a language server")
	}
	adapter, found := s.workspace.languages.Get(languageID)
	if !found {
		return FormatResult{}, fmt.Errorf("no language provider for %s", languageID)
	}
	provider, supported := adapter.(language.FormatToolProvider)
	if !supported {
		return FormatResult{}, fmt.Errorf("no formatting tool for %s", languageID)
	}
	workingDirectory := filepath.Dir(path)
	relative, err := filepath.Rel(session.Project.RealPath, path)
	if err != nil || strings.HasPrefix(relative, "..") {
		relative = filepath.Base(path)
	}
	spec, available, reason, err := provider.FormatTool(language.FormatRequest{
		Root: session.Project.RealPath, WorkingDirectory: workingDirectory,
		Path: path, RelativePath: filepath.ToSlash(relative),
	})
	if err != nil {
		return FormatResult{}, err
	}
	if !available {
		if reason == "" {
			reason = "the formatting tool is not installed"
		}
		return FormatResult{}, fmt.Errorf("%s", reason)
	}
	if !isAbsoluteExistingFile(spec.Executable) {
		return FormatResult{}, fmt.Errorf("the formatting tool is not executable: %s", spec.Executable)
	}
	formatted, err := runFormatTool(ctx, spec, text, workingDirectory)
	if err != nil {
		return FormatResult{}, err
	}
	if formatted == text {
		return FormatResult{Version: version, Edits: []EditorTextEdit{}}, nil
	}
	start := editorPositionAt(text, 0)
	end := editorPositionAt(text, len(text))
	return FormatResult{Version: version, Edits: []EditorTextEdit{{
		Range: EditorRange{StartLine: start.line, StartColumn: start.column, EndLine: end.line, EndColumn: end.column},
		Text:  formatted,
	}}}, nil
}

// runFormatTool esegue lo strumento con texto su stdin e restituisce stdout; un errore riporta il
// primo messaggio utile, non un output grezzo di terminale.
func runFormatTool(ctx context.Context, spec run.CommandSpec, text, directory string) (string, error) {
	if !isAbsoluteExistingFile(spec.Executable) {
		return "", fmt.Errorf("the formatting tool is not executable: %s", spec.Executable)
	}
	runCtx, cancel := context.WithTimeout(ctx, formatToolTimeout)
	defer cancel()
	command := procutil.CommandContext(runCtx, spec.Executable, spec.Arguments...)
	process.Configure(command, false)
	command.Dir = directory
	command.Env = environmentWith(nil)
	command.Stdin = strings.NewReader(text)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if runCtx.Err() != nil {
			return "", fmt.Errorf("the formatting tool did not finish in time")
		}
		message := firstMeaningfulLine(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("the formatting tool failed: %s", message)
	}
	return stdout.String(), nil
}

func isAbsoluteExistingFile(path string) bool {
	if !filepath.IsAbs(path) {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// firstLine è il messaggio compatto di uno strumento: la prima riga non vuota di stderr.
func firstMeaningfulLine(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
