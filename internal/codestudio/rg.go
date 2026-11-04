package codestudio

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// ripgrep è il motore di Find in Files quando è disponibile: è l'unico modo per restare veloci su
// workspace con centinaia di migliaia di file. Il motore Go resta come fallback (installazioni
// portabili senza rg, macchine senza il binario), così l'interfaccia non cambia mai.
//
// Le directory ignorate sono le stesse di project.SkipDirectory: rg applica già .gitignore e i file
// nascosti, ma non ha motivo di conoscere le nostre esclusioni.
var ripgrepIgnoredDirectories = []string{
	".git", ".idea", ".vscode", "node_modules", "vendor", "bin", "dist", "coverage", ".cache",
	"__pycache__", ".venv", ".gradle", ".next", ".nuxt", ".turbo", ".terraform", ".pytest_cache", ".mypy_cache",
}

// RipgrepInfo dice alla UI quale motore sta usando la ricerca.
type RipgrepInfo struct {
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
}

// RipgrepBinary returns the bundled or installed ripgrep, in resolution order: the explicit
// ADOMNIA_RG override, the folder of the app (bin/ and next to the executable, including the
// macOS Resources/bin), the managed tools folder and finally PATH.
func RipgrepBinary(toolsRoot string) (string, bool) {
	names := []string{"rg"}
	if runtime.GOOS == "windows" {
		names = []string{"rg.exe", "rg"}
	}
	try := func(candidate string) (string, bool) {
		info, err := os.Stat(candidate)
		if err != nil || info.IsDir() {
			return "", false
		}
		return candidate, true
	}
	if custom := strings.TrimSpace(os.Getenv("ADOMNIA_RG")); custom != "" {
		return try(custom)
	}
	if executable, err := os.Executable(); err == nil {
		dir := filepath.Dir(executable)
		for _, name := range names {
			for _, candidate := range []string{
				filepath.Join(dir, name),
				filepath.Join(dir, "bin", name),
				filepath.Join(dir, "..", "Resources", "bin", name),
			} {
				if path, ok := try(candidate); ok {
					return path, true
				}
			}
		}
	}
	if toolsRoot != "" {
		for _, name := range names {
			if path, ok := try(filepath.Join(toolsRoot, "bin", name)); ok {
				return path, true
			}
		}
	}
	for _, name := range names {
		if path, err := exec.LookPath(name); err == nil {
			return path, true
		}
	}
	return "", false
}

// RipgrepStatus is what the UI and the installer show: whether the fast engine is in use.
func (s *Service) RipgrepStatus() RipgrepInfo {
	path, ok := RipgrepBinary(s.toolsRoot)
	if !ok {
		return RipgrepInfo{}
	}
	info := RipgrepInfo{Available: true, Path: path}
	if version := ripgrepVersion(path); version != "" {
		info.Version = version
	}
	return info
}

func ripgrepVersion(binary string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := procutil.CommandContext(ctx, binary, "--version").Output()
	if err != nil {
		return ""
	}
	line, _, _ := strings.Cut(string(out), "\n")
	return strings.TrimSpace(line)
}

// ripgrepArgs builds the command line. The search root is the working directory, so paths in the
// output stay relative and the result does not leak the absolute workspace path to the UI.
func ripgrepArgs(query SearchQuery, sortByPath bool) []string {
	threads := runtime.NumCPU()
	if threads > searchWorkers {
		threads = searchWorkers
	}
	if threads < 1 {
		threads = 1
	}
	args := []string{
		"--json", "--no-config", "--color=never", "--stats", "--no-require-git",
		"--max-filesize=" + strconv.Itoa(maxSearchFileBytes),
		"--threads=" + strconv.Itoa(threads),
	}
	if !query.CaseSensitive {
		args = append(args, "--ignore-case")
	} else {
		args = append(args, "--case-sensitive")
	}
	if query.WholeWord {
		args = append(args, "--word-regexp")
	}
	if !query.Regex {
		args = append(args, "--fixed-strings")
	}
	if sortByPath {
		// La ricerca sincrona (anteprima Replace) ordina per percorso; lo streaming resta parallelo.
		args = append(args, "--sort", "path")
	}
	for _, include := range query.Include {
		if pattern := strings.TrimSpace(include); pattern != "" {
			args = append(args, "--glob="+pattern)
		}
	}
	for _, exclude := range query.Exclude {
		if pattern := strings.TrimSpace(exclude); pattern != "" {
			args = append(args, "--glob=!"+pattern)
		}
	}
	for _, directory := range ripgrepIgnoredDirectories {
		args = append(args, "--glob=!**/"+directory+"/**")
	}
	return append(args, "--", query.Pattern)
}

// rgEvent is the subset of ripgrep's --json stream we use.
type rgEvent struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type rgMatchData struct {
	Path struct {
		Text string `json:"text"`
	} `json:"path"`
	Lines struct {
		Text string `json:"text"`
	} `json:"lines"`
	LineNumber int `json:"line_number"`
	Submatches []struct {
		Start int `json:"start"`
		End   int `json:"end"`
	} `json:"submatches"`
}

type rgSummaryData struct {
	Stats struct {
		MatchedLines int `json:"matched_lines"`
		Searches     int `json:"searches"`
	} `json:"stats"`
}

// ripgrepMatches converts one ripgrep JSON line into UI matches. RIPGREP DÀ offset in byte nel
// testo della riga: le colonne restano in unità UTF-16, come le usa Monaco.
func ripgrepMatches(data rgMatchData) []SearchMatch {
	line := strings.TrimRight(data.Lines.Text, "\r\n")
	preview := previewLine(line)
	matches := make([]SearchMatch, 0, len(data.Submatches))
	for _, submatch := range data.Submatches {
		start, end := clampByteRange(line, submatch.Start, submatch.End)
		if start == end {
			continue
		}
		matches = append(matches, SearchMatch{
			RelativePath: filepath.ToSlash(data.Path.Text),
			Line:         data.LineNumber,
			Column:       utf16Length(line[:start]) + 1,
			EndColumn:    utf16Length(line[:end]) + 1,
			Preview:      preview,
		})
	}
	return matches
}

func clampByteRange(line string, start, end int) (int, int) {
	if start < 0 {
		start = 0
	}
	if start > len(line) {
		start = len(line)
	}
	if end < start {
		end = start
	}
	if end > len(line) {
		end = len(line)
	}
	return start, end
}

// searchWithRipgrep runs ripgrep and returns the ordered result. The streaming variant is
// ripgrepStream, used by StartProjectSearch.
func (s *Service) searchWithRipgrep(ctx context.Context, binary, root string, query SearchQuery) (SearchResult, error) {
	result := SearchResult{Matches: []SearchMatch{}}
	err := s.ripgrepStream(ctx, binary, root, query, streamBatchSize, true, func(matches []SearchMatch, scanned int, truncated bool) bool {
		result.Matches = append(result.Matches, matches...)
		if scanned > result.FilesScanned {
			result.FilesScanned = scanned
		}
		if truncated {
			result.Truncated = true
		}
		return true
	})
	if err != nil {
		return SearchResult{}, err
	}
	sortSearchMatches(result.Matches)
	return result, nil
}

// streamBatchSize is how many matches are emitted together: small enough to feel live, large
// enough to not flood the event channel.
const streamBatchSize = 80

// ripgrepStream runs ripgrep and calls emit with batches of matches. Returning false from emit
// stops the process (the caller reached its own cap).
func (s *Service) ripgrepStream(ctx context.Context, binary, root string, query SearchQuery, batchSize int, sortByPath bool, emit func(matches []SearchMatch, filesScanned int, truncated bool) bool) error {
	command := procutil.CommandContext(ctx, binary, ripgrepArgs(query, sortByPath)...)
	command.Dir = root
	stdout, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		return fmt.Errorf("ripgrep: %w", err)
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	batch := make([]SearchMatch, 0, batchSize)
	total, scanned, truncated := 0, 0, false
	stop := func() {
		truncated = true
		if command.Process != nil {
			if err := command.Process.Kill(); err != nil {
				return
			}
		}
	}
streamLoop:
	for scanner.Scan() {
		if ctx.Err() != nil {
			stop()
			break
		}
		var event rgEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}
		switch event.Type {
		case "begin":
			scanned++
		case "match":
			var data rgMatchData
			if err := json.Unmarshal(event.Data, &data); err != nil {
				continue
			}
			matches := ripgrepMatches(data)
			if len(matches) == 0 {
				continue
			}
			batch = append(batch, matches...)
			total += len(matches)
			if total >= maxSearchResults {
				if total > maxSearchResults {
					batch = batch[:len(batch)-(total-maxSearchResults)]
					total = maxSearchResults
				}
				truncated = true
				if len(batch) > 0 {
					emit(batch, scanned, truncated)
				}
				batch = nil
				stop()
				break streamLoop
			}
			if len(batch) >= batchSize {
				if !emit(batch, scanned, false) {
					stop()
					batch = nil
					break streamLoop
				}
				batch = batch[:0]
			}
		case "summary":
			var data rgSummaryData
			if err := json.Unmarshal(event.Data, &data); err == nil && data.Stats.Searches > scanned {
				scanned = data.Stats.Searches
			}
		}
	}
	if len(batch) > 0 {
		emit(batch, scanned, truncated)
	}
	scanErr := scanner.Err()
	waitErr := command.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if scanErr != nil && !errors.Is(scanErr, os.ErrClosed) {
		return fmt.Errorf("ripgrep: %w", scanErr)
	}
	// Exit code 1 means "no matches", which is a successful empty search; 2 is a real error
	// (bad pattern, unreadable root). Everything else is unexpected.
	if waitErr != nil {
		var exitError *exec.ExitError
		if errors.As(waitErr, &exitError) {
			switch exitError.ExitCode() {
			case 1:
				return nil
			case 2:
				if detail := strings.TrimSpace(stderr.String()); detail != "" {
					return fmt.Errorf("ripgrep: %s", detail)
				}
				return fmt.Errorf("ripgrep: search failed")
			}
		}
		if truncated {
			return nil
		}
		return fmt.Errorf("ripgrep: %w", waitErr)
	}
	return nil
}

func sortSearchMatches(matches []SearchMatch) {
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].RelativePath != matches[j].RelativePath {
			return matches[i].RelativePath < matches[j].RelativePath
		}
		if matches[i].Line != matches[j].Line {
			return matches[i].Line < matches[j].Line
		}
		return matches[i].Column < matches[j].Column
	})
}
