package goide

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

const (
	LinterGolangci    = "golangci-lint"
	LinterStaticcheck = "staticcheck"
	lintTimeout       = 5 * time.Minute
	maxLintOutput     = 32 * 1024 * 1024
	maxLintIssues     = 5_000
)

var (
	linterModules = map[string]string{
		LinterGolangci:    "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest",
		LinterStaticcheck: "honnef.co/go/tools/cmd/staticcheck@latest",
	}
	linterConfigFiles = map[string][]string{
		LinterGolangci:    {".golangci.yml", ".golangci.yaml", ".golangci.toml", ".golangci.json"},
		LinterStaticcheck: {"staticcheck.conf"},
	}
	golangciVersionPattern = regexp.MustCompile(`version v?(\d+)\.(\d+)\.(\d+)`)
)

type LinterInfo struct {
	Available  bool   `json:"available"`
	Kind       string `json:"kind,omitempty"`
	Binary     string `json:"binary,omitempty"`
	Version    string `json:"version,omitempty"`
	Source     string `json:"source,omitempty"`
	ConfigPath string `json:"configPath,omitempty"`
	Error      string `json:"error,omitempty"`
}

type LintResult struct {
	Linter     string              `json:"linter"`
	Reports    []DiagnosticsReport `json:"reports"`
	IssueCount int                 `json:"issueCount"`
	Truncated  bool                `json:"truncated"`
	DurationMS int64               `json:"durationMs"`
	// ChangedOnly indica che il linter ha girato solo sui package dei file Go modificati e
	// che Reports contiene solo quei file; ChangedFiles è il loro numero.
	ChangedOnly  bool `json:"changedOnly,omitempty"`
	ChangedFiles int  `json:"changedFiles,omitempty"`
	// Baselined conta i problemi nascosti perché già presenti in .adomnia/lint-baseline.json.
	Baselined int `json:"baselined,omitempty"`
}

type lintIssue struct {
	path     string
	line     int
	column   int
	severity int
	source   string
	code     string
	message  string
	// suppression è la direttiva ufficiale del linter per ignorare la riga (//nolint:x o //lint:ignore).
	suppression string
	fixes       []lintFix
}

// lintFix è una correzione proposta dal linter, con edit in byte sul contenuto analizzato.
type lintFix struct {
	title string
	edits []byteEdit
}

type byteEdit struct {
	start, end int
	text       string
}

type linterCandidate struct {
	kind   string
	binary string
	source string
}

// lintRegistry tiene i binari personalizzati per sessione.
type lintRegistry struct {
	mu     sync.RWMutex
	custom map[SessionID]string
}

func (s *Service) linterCandidates(sessionID SessionID) []linterCandidate {
	candidates := []linterCandidate{}
	s.lint.mu.RLock()
	custom := s.lint.custom[sessionID]
	s.lint.mu.RUnlock()
	if custom != "" {
		candidates = append(candidates, linterCandidate{kind: linterKindForBinary(custom), binary: custom, source: "custom"})
	}
	directories := []struct{ path, source string }{}
	if s.toolsRoot != "" {
		directories = append(directories, struct{ path, source string }{filepath.Join(s.toolsRoot, "bin"), "managed"})
	}
	if info, ok := s.toolchain.LastDetected(sessionID); ok {
		for _, gopath := range filepath.SplitList(info.GOPATH) {
			directories = append(directories, struct{ path, source string }{filepath.Join(gopath, "bin"), "GOPATH"})
		}
	}
	// golangci-lint è preferito perché aggrega staticcheck e altri linter.
	for _, kind := range []string{LinterGolangci, LinterStaticcheck} {
		for _, directory := range directories {
			candidates = append(candidates, linterCandidate{kind: kind, binary: filepath.Join(directory.path, executableName(kind)), source: directory.source})
		}
		if found, err := exec.LookPath(kind); err == nil {
			candidates = append(candidates, linterCandidate{kind: kind, binary: found, source: "PATH"})
		}
	}
	return candidates
}

func linterKindForBinary(binary string) string {
	if strings.Contains(strings.ToLower(filepath.Base(binary)), "staticcheck") {
		return LinterStaticcheck
	}
	return LinterGolangci
}

// DetectLinter individua golangci-lint o staticcheck e l'eventuale configurazione di progetto, senza crearla.
func (s *Service) DetectLinter(sessionID string) (LinterInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return LinterInfo{}, err
	}
	for _, candidate := range s.linterCandidates(session.ID) {
		info, statErr := os.Stat(candidate.binary)
		if statErr != nil || info.IsDir() {
			if candidate.source == "custom" {
				return LinterInfo{Binary: candidate.binary, Source: "custom", Error: "il binario del linter configurato non esiste"}, nil
			}
			continue
		}
		version, versionErr := cachedToolVersion(candidate.binary, func(binary string) (string, error) { return linterVersion(candidate.kind, binary) })
		result := LinterInfo{Kind: candidate.kind, Binary: candidate.binary, Source: candidate.source, ConfigPath: linterConfig(session.Project.RealPath, candidate.kind)}
		if versionErr != nil {
			result.Error = versionErr.Error()
			return result, nil
		}
		result.Available = true
		result.Version = version
		return result, nil
	}
	return LinterInfo{Error: "nessun linter trovato: installa golangci-lint o staticcheck dal menu Go"}, nil
}

func linterConfig(root, kind string) string {
	for _, name := range linterConfigFiles[kind] {
		path := filepath.Join(root, name)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path
		}
	}
	return ""
}

func linterVersion(kind, binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), goplsVersionTimeout)
	defer cancel()
	flag := "version"
	if kind == LinterStaticcheck {
		flag = "-version"
	}
	command := exec.CommandContext(ctx, binary, flag)
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return "", fmt.Errorf("%s non risponde", kind)
	}
	if err != nil {
		return "", fmt.Errorf("%s non eseguibile: %s", kind, strings.TrimSpace(string(output)))
	}
	text := strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0])
	if match := golangciVersionPattern.FindStringSubmatch(text); match != nil {
		return "v" + match[1] + "." + match[2] + "." + match[3], nil
	}
	return text, nil
}

// ConfigureLinter imposta un binario linter personalizzato per la sessione; vuoto ripristina la ricerca automatica.
func (s *Service) ConfigureLinter(sessionID, binary string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	binary = strings.TrimSpace(binary)
	if binary != "" {
		abs, err := filepath.Abs(binary)
		if err != nil {
			return fmt.Errorf("percorso linter non valido: %w", err)
		}
		if info, err := os.Stat(abs); err != nil || info.IsDir() {
			return fmt.Errorf("il percorso indicato non è un eseguibile")
		}
		binary = abs
	}
	s.lint.mu.Lock()
	if binary == "" {
		delete(s.lint.custom, SessionID(sessionID))
	} else {
		s.lint.custom[SessionID(sessionID)] = binary
	}
	s.lint.mu.Unlock()
	return nil
}

// InstallLinter esegue `go install` del linter scelto nella cartella strumenti di adOmnia dopo conferma esplicita.
func (s *Service) InstallLinter(sessionID, kind string, confirmed bool) (Execution, error) {
	module, ok := linterModules[kind]
	if !ok {
		return Execution{}, fmt.Errorf("linter non supportato")
	}
	return s.installTool(sessionID, module, confirmed)
}

// RunLint esegue il linter sul progetto; ctx annullato termina l'intero albero di processi.
func (s *Service) RunLint(ctx context.Context, sessionID string) (LintResult, error) {
	return s.runLint(ctx, sessionID, false)
}

// RunLintChanged esegue il linter solo sui package dei file Go modificati (git status) e
// riporta solo i problemi di quei file.
func (s *Service) RunLintChanged(ctx context.Context, sessionID string) (LintResult, error) {
	return s.runLint(ctx, sessionID, true)
}

// changedGoFiles restituisce i file Go modificati, staged o nuovi (relativi al progetto, con /)
// e i loro package come pattern relativi alla radice del progetto.
func (s *Service) changedGoFiles(sessionID string) (map[string]bool, []string, error) {
	status, err := s.VCSStatus(sessionID)
	if err != nil {
		return nil, nil, err
	}
	if !status.Available {
		return nil, nil, fmt.Errorf("il progetto non è in un repository Git: %s", status.Reason)
	}
	files := map[string]bool{}
	seen := map[string]bool{}
	var packages []string
	for _, change := range status.Changes {
		path := filepath.ToSlash(change.RelativePath)
		if !strings.HasSuffix(path, ".go") || strings.Contains(change.Status, "D") {
			continue
		}
		files[path] = true
		pattern := "./" + pathpkg.Dir(path)
		if pattern == "./." {
			pattern = "."
		}
		if !seen[pattern] {
			seen[pattern] = true
			packages = append(packages, pattern)
		}
	}
	sort.Strings(packages)
	return files, packages, nil
}

func (s *Service) runLint(ctx context.Context, sessionID string, changedOnly bool) (LintResult, error) {
	started := time.Now()
	session, kind, issues, changed, err := s.collectLintIssues(ctx, sessionID, changedOnly)
	if err != nil {
		return LintResult{}, err
	}
	result := LintResult{Linter: kind, ChangedOnly: changedOnly, ChangedFiles: len(changed)}
	issues, result.Baselined = applyLintBaseline(session.Project.RealPath, issues)
	result.DurationMS = time.Since(started).Milliseconds()
	if len(issues) > maxLintIssues {
		issues = issues[:maxLintIssues]
		result.Truncated = true
	}
	result.IssueCount = len(issues)
	result.Reports = lintReports(session, issues)
	return result, nil
}

// collectLintIssues esegue il linter (tutto il progetto o i soli package dei file modificati).
func (s *Service) collectLintIssues(ctx context.Context, sessionID string, changedOnly bool) (Session, string, []lintIssue, map[string]bool, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Session{}, "", nil, nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Session{}, "", nil, nil, fmt.Errorf("autorizza esplicitamente gli strumenti prima di eseguire il linter")
	}
	info, err := s.DetectLinter(sessionID)
	if err != nil {
		return Session{}, "", nil, nil, err
	}
	if !info.Available {
		return Session{}, "", nil, nil, errors.New(info.Error)
	}
	environment, err := s.languageServerEnvironment(session.ID)
	if err != nil {
		return Session{}, "", nil, nil, err
	}
	packages := []string{"./..."}
	var changed map[string]bool
	if changedOnly {
		if changed, packages, err = s.changedGoFiles(sessionID); err != nil {
			return Session{}, "", nil, nil, err
		}
		if len(packages) == 0 {
			return session, info.Kind, nil, changed, nil
		}
	}
	output, err := runLinter(ctx, info, session.Project.RealPath, environment, packages)
	if err != nil {
		return Session{}, "", nil, nil, err
	}
	issues, err := parseLintOutput(info.Kind, session.Project.RealPath, output)
	if err != nil {
		return Session{}, "", nil, nil, err
	}
	if changedOnly {
		issues = slices.DeleteFunc(issues, func(issue lintIssue) bool { return !changed[relativeWithin(session.Project.RealPath, issue.path)] })
	}
	return session, info.Kind, issues, changed, nil
}

func lintArguments(info LinterInfo, packages []string) []string {
	var arguments []string
	switch {
	case info.Kind == LinterStaticcheck:
		arguments = []string{"-f", "json"}
	case strings.HasPrefix(info.Version, "v1."):
		arguments = []string{"run", "--out-format", "json"}
	default:
		arguments = []string{"run", "--output.json.path=stdout", "--show-stats=false"}
	}
	return append(arguments, packages...)
}

func runLinter(ctx context.Context, info LinterInfo, root string, environment []string, packages []string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, lintTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, info.Binary, lintArguments(info, packages)...)
	command.Dir = root
	command.Env = environment
	configureProcess(command, false)
	command.Cancel = func() error { return terminateProcessTree(command) }
	var stdout, stderr limitedBuffer
	stdout.limit, stderr.limit = maxLintOutput, 64*1024
	command.Stdout, command.Stderr = &stdout, &stderr
	err := command.Run()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	// I linter escono con codice diverso da zero quando trovano problemi: conta solo l'output JSON.
	if stdout.Len() == 0 && err != nil {
		return nil, fmt.Errorf("%s fallito: %s", info.Kind, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

type limitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *limitedBuffer) Write(data []byte) (int, error) {
	if remaining := b.limit - b.Len(); remaining > 0 {
		b.Buffer.Write(data[:min(len(data), remaining)])
	}
	return len(data), nil
}

func parseLintOutput(kind, root string, output []byte) ([]lintIssue, error) {
	if kind == LinterStaticcheck {
		return parseStaticcheck(output)
	}
	return parseGolangci(root, output)
}

func parseGolangci(root string, output []byte) ([]lintIssue, error) {
	start := bytes.IndexByte(output, '{')
	if start < 0 {
		return []lintIssue{}, nil
	}
	var report struct {
		Issues []struct {
			FromLinter string `json:"FromLinter"`
			Text       string `json:"Text"`
			Severity   string `json:"Severity"`
			Pos        struct {
				Filename string `json:"Filename"`
				Line     int    `json:"Line"`
				Column   int    `json:"Column"`
			} `json:"Pos"`
			SuggestedFixes []struct {
				Message   string `json:"Message"`
				TextEdits []struct {
					Pos     int    `json:"Pos"`
					End     int    `json:"End"`
					NewText []byte `json:"NewText"`
				} `json:"TextEdits"`
			} `json:"SuggestedFixes"`
		} `json:"Issues"`
	}
	if err := json.NewDecoder(bytes.NewReader(output[start:])).Decode(&report); err != nil {
		return nil, fmt.Errorf("output golangci-lint non valido: %w", err)
	}
	issues := make([]lintIssue, 0, len(report.Issues))
	for _, issue := range report.Issues {
		path := filepath.FromSlash(issue.Pos.Filename)
		if !filepath.IsAbs(path) {
			path = filepath.Join(root, path)
		}
		fixes := make([]lintFix, 0, len(issue.SuggestedFixes))
		for _, suggested := range issue.SuggestedFixes {
			fix := lintFix{title: suggested.Message}
			for _, edit := range suggested.TextEdits {
				fix.edits = append(fix.edits, byteEdit{start: edit.Pos, end: edit.End, text: string(edit.NewText)})
			}
			fixes = append(fixes, fix)
		}
		issues = append(issues, lintIssue{
			path: path, line: issue.Pos.Line, column: issue.Pos.Column, severity: lintSeverity(issue.Severity),
			source: "golangci-lint · " + issue.FromLinter, message: issue.Text,
			suppression: "//nolint:" + issue.FromLinter, fixes: fixes,
		})
	}
	return issues, nil
}

func parseStaticcheck(output []byte) ([]lintIssue, error) {
	issues := []lintIssue{}
	scanner := bufio.NewScanner(bytes.NewReader(output))
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var issue struct {
			Code     string `json:"code"`
			Severity string `json:"severity"`
			Message  string `json:"message"`
			Location struct {
				File   string `json:"file"`
				Line   int    `json:"line"`
				Column int    `json:"column"`
			} `json:"location"`
		}
		if err := json.Unmarshal(line, &issue); err != nil {
			return nil, fmt.Errorf("output staticcheck non valido: %w", err)
		}
		if issue.Location.File == "" {
			continue
		}
		issues = append(issues, lintIssue{
			path: issue.Location.File, line: issue.Location.Line, column: issue.Location.Column,
			severity: lintSeverity(issue.Severity), source: "staticcheck", code: issue.Code, message: issue.Message,
			suppression: "//lint:ignore " + issue.Code + " reason",
		})
	}
	return issues, nil
}

// lintSeverity usa warning come default: i problemi di stile non devono sembrare errori di compilazione.
func lintSeverity(value string) int {
	switch strings.ToLower(value) {
	case "error":
		return 1
	case "info", "information":
		return 3
	case "hint":
		return 4
	default:
		return 2
	}
}

// lintReports raggruppa per file e converte le colonne in byte dei linter in colonne UTF-16 come Monaco.
func lintReports(session Session, issues []lintIssue) []DiagnosticsReport {
	byPath := map[string][]lintIssue{}
	for _, issue := range issues {
		byPath[issue.path] = append(byPath[issue.path], issue)
	}
	reports := make([]DiagnosticsReport, 0, len(byPath))
	for path, fileIssues := range byPath {
		relative := relativeWithin(session.Project.RealPath, path)
		if relative == "" {
			continue
		}
		text, _, _, _ := readTextFile(path)
		lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
		diagnostics := make([]EditorDiagnostic, 0, len(fileIssues))
		for _, issue := range fileIssues {
			line := max(1, issue.line)
			column := utf16Column(lines, line, issue.column)
			diagnostics = append(diagnostics, EditorDiagnostic{
				Range:    EditorRange{StartLine: line, StartColumn: column, EndLine: line, EndColumn: column + 1},
				Severity: issue.severity, Message: issue.message, Source: issue.source, Code: issue.code,
				Suppression: issue.suppression, Fixes: diagnosticFixes(text, issue.fixes),
			})
		}
		sort.Slice(diagnostics, func(left, right int) bool {
			return diagnostics[left].Range.StartLine < diagnostics[right].Range.StartLine
		})
		uri := fileURI(path)
		reports = append(reports, DiagnosticsReport{URI: uri, Path: path, RelativePath: relative, DocumentID: stableDocumentID(session.ID, path), Diagnostics: diagnostics})
	}
	sort.Slice(reports, func(left, right int) bool { return reports[left].RelativePath < reports[right].RelativePath })
	return reports
}

func utf16Column(lines []string, line, byteColumn int) int {
	if byteColumn <= 1 || line > len(lines) {
		return max(1, byteColumn)
	}
	text := lines[line-1]
	offset := min(byteColumn-1, len(text))
	return len(utf16.Encode([]rune(text[:offset]))) + 1
}

// diagnosticFixes converte gli offset in byte dei linter in intervalli Monaco; una correzione con edit fuori testo viene scartata.
func diagnosticFixes(text string, fixes []lintFix) []DiagnosticFix {
	converted := make([]DiagnosticFix, 0, len(fixes))
	for _, fix := range fixes {
		edits, ok := editorEditsForBytes(text, fix.edits)
		if ok && len(edits) > 0 {
			converted = append(converted, DiagnosticFix{Title: fix.title, Edits: edits})
		}
	}
	return converted
}

func editorEditsForBytes(text string, edits []byteEdit) ([]EditorTextEdit, bool) {
	converted := make([]EditorTextEdit, 0, len(edits))
	for _, edit := range edits {
		if edit.start < 0 || edit.end < edit.start || edit.end > len(text) {
			return nil, false
		}
		start, end := editorPositionAt(text, edit.start), editorPositionAt(text, edit.end)
		converted = append(converted, EditorTextEdit{Range: EditorRange{StartLine: start.line, StartColumn: start.column, EndLine: end.line, EndColumn: end.column}, Text: edit.text})
	}
	return converted, true
}

type editorPosition struct{ line, column int }

// editorPositionAt restituisce riga e colonna Monaco (1-based, UTF-16) dell'offset in byte.
func editorPositionAt(text string, offset int) editorPosition {
	prefix := text[:offset]
	line := strings.Count(prefix, "\n") + 1
	lineStart := strings.LastIndexByte(prefix, '\n') + 1
	return editorPosition{line: line, column: len(utf16.Encode([]rune(prefix[lineStart:]))) + 1}
}
