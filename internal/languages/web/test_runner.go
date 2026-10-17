package web

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"adomnia/internal/ide/run"
	idetesting "adomnia/internal/ide/testing"
)

// TestOptions sono le opzioni di LanguageOptions per i test JS/TS. Hanno gli stessi nomi JSON della
// richiesta generica dell'host: Packages sono i file di test (relativi alla cartella), Run è il filtro sul nome.
type TestOptions struct {
	Packages []string `json:"packages"`
	Run      string   `json:"run"`
}

const maxTestFiles = 64

// TestCommand avvia Vitest o Jest con il loro report JSON e lo traduce nell'albero dei test dell'IDE.
// Il package manager reale esegue il binario locale del progetto: nessun download, nessun runner globale.
func (scriptAdapter) TestCommand(request idetesting.Request) (run.CommandSpec, idetesting.EventParser, error) {
	var options TestOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return run.CommandSpec{}, nil, fmt.Errorf("invalid test options: %w", err)
		}
	}
	info, err := Inspect(request.Root, request.WorkingDirectory)
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	if info.Kind != UnitNode || info.TestFramework == "" {
		return run.CommandSpec{}, nil, fmt.Errorf("no Vitest or Jest found in %s: add one to the package.json dependencies", filepath.ToSlash(request.WorkingDirectory))
	}
	if !info.DependenciesInstalled {
		return run.CommandSpec{}, nil, fmt.Errorf("the project dependencies are not installed: install them before running the tests")
	}
	if len(options.Packages) > maxTestFiles {
		return run.CommandSpec{}, nil, fmt.Errorf("too many test files: at most %d", maxTestFiles)
	}
	for _, file := range options.Packages {
		if err := run.ValidateTarget(request.Root, request.WorkingDirectory, file); err != nil {
			return run.CommandSpec{}, nil, err
		}
	}
	if options.Run != "" {
		if _, err := regexp.Compile(options.Run); err != nil {
			return run.CommandSpec{}, nil, fmt.Errorf("invalid filter expression %q: %w", options.Run, err)
		}
	}
	binary, err := exec.LookPath(info.PackageManager)
	if err != nil {
		return run.CommandSpec{}, nil, fmt.Errorf("%s was not found on this machine", info.PackageManager)
	}
	// Vitest 5 non stampa più il report JSON: lo scrive nel file indicato, che il parser legge a fine run. Il
	// percorso è relativo e senza spazi (sotto node_modules, che esiste già): niente quoting per cmd.exe.
	reportArgument, reportFile := "", ""
	if info.TestFramework == "vitest" {
		reportArgument = "node_modules/.adomnia-" + strconv.FormatInt(time.Now().UnixNano(), 36) + ".json"
		reportFile = filepath.Join(request.WorkingDirectory, filepath.FromSlash(reportArgument))
	}
	arguments := testArguments(info, options, reportArgument)
	if err := checkBatchSafe(binary, arguments); err != nil {
		return run.CommandSpec{}, nil, err
	}
	// CI=1 impedisce a Jest e Vitest di entrare in watch mode.
	environment := append(append([]string(nil), request.Environment...), "CI=1")
	spec := run.CommandSpec{
		Executable: binary, Arguments: arguments, WorkingDirectory: request.WorkingDirectory, Environment: environment,
		DisplayCommand: info.PackageManager + " " + strings.Join(arguments, " "), QuietStdout: true,
	}
	return spec, &reportParser{root: request.Root, file: reportFile}, nil
}

// batchUnsafe sono i caratteri che `cmd.exe` interpreta (o che rompono il quoting) quando un .cmd riceve gli argomenti.
const batchUnsafe = " \t\r\n&|<>^%!\"`"

// checkBatchSafe rifiuta gli argomenti che un package manager installato come .cmd/.bat (npm.cmd, pnpm.cmd)
// non può ricevere in sicurezza: Windows li rilegge con cmd.exe, quindi `&` in un nome di test diventerebbe un comando.
func checkBatchSafe(binary string, arguments []string) error {
	if runtime.GOOS != "windows" {
		return nil
	}
	if extension := strings.ToLower(filepath.Ext(binary)); extension != ".cmd" && extension != ".bat" {
		return nil
	}
	for _, argument := range arguments {
		if index := strings.IndexAny(argument, batchUnsafe); index >= 0 {
			return fmt.Errorf("the argument %q contains %q, which Windows cannot pass safely to %s: run the whole test file instead", argument, argument[index], filepath.Base(binary))
		}
	}
	return nil
}

// testArguments esegue il binario locale del runner tramite il package manager del progetto.
func testArguments(info Info, options TestOptions, reportFile string) []string {
	var arguments []string
	switch info.PackageManager {
	case NPM:
		arguments = []string{"exec", "--", info.TestFramework}
	case Bun:
		arguments = []string{"x", info.TestFramework}
	default: // pnpm e yarn (classic e berry) hanno entrambi `exec`
		arguments = []string{"exec", info.TestFramework}
	}
	if info.TestFramework == "vitest" {
		arguments = append(arguments, "run", "--reporter=json")
		if reportFile != "" {
			arguments = append(arguments, "--outputFile="+reportFile)
		}
		if options.Run != "" {
			arguments = append(arguments, "-t", options.Run)
		}
	} else {
		arguments = append(arguments, "--json", "--ci")
		if options.Run != "" {
			arguments = append(arguments, "-t", options.Run)
		}
	}
	return append(arguments, options.Packages...)
}

// jsonReport è la parte comune ai report di Jest e Vitest che serve all'albero.
type jsonReport struct {
	TestResults []struct {
		Name             string  `json:"name"`
		Status           string  `json:"status"`
		Message          string  `json:"message"`
		StartTime        float64 `json:"startTime"`
		EndTime          float64 `json:"endTime"`
		AssertionResults []struct {
			AncestorTitles  []string `json:"ancestorTitles"`
			Title           string   `json:"title"`
			Status          string   `json:"status"`
			Duration        float64  `json:"duration"`
			FailureMessages []string `json:"failureMessages"`
		} `json:"assertionResults"`
	} `json:"testResults"`
}

// maxReportBytes limita il report accumulato: oltre, l'output non è più un report utile.
const maxReportBytes = 16 << 20

// reportParser accumula l'output del runner finché forma un documento JSON completo, poi lo converte
// in eventi. Jest lo stampa su una riga, Vitest indentato: un documento indentato finisce con "}" a colonna 0.
type reportParser struct {
	root string
	// file è dove Vitest scrive il report (vuoto: il runner lo stampa su stdout, come Jest).
	file   string
	buffer []byte
	done   bool
}

// reportWritten è la riga con cui Vitest annuncia di aver scritto il report su file.
var reportWritten = regexp.MustCompile(`^JSON report written to `)

func (p *reportParser) Parse([]byte) (idetesting.Event, bool) { return idetesting.Event{}, false }

func (p *reportParser) ParseAll(line []byte) []idetesting.Event {
	if p.done {
		return nil
	}
	trimmed := bytes.TrimRight(line, "\r")
	if p.file != "" && reportWritten.Match(trimmed) {
		return p.readFile()
	}
	if len(p.buffer) == 0 && !bytes.HasPrefix(trimmed, []byte("{")) {
		return nil
	}
	if len(p.buffer)+len(trimmed) > maxReportBytes {
		p.buffer, p.done = nil, true
		return nil
	}
	p.buffer = append(append(p.buffer, trimmed...), '\n')
	if len(p.buffer) > len(trimmed)+1 && !bytes.Equal(trimmed, []byte("}")) {
		return nil
	}
	var report jsonReport
	if json.Unmarshal(p.buffer, &report) != nil || report.TestResults == nil {
		return nil
	}
	p.done = true
	return reportEvents(p.root, report)
}

// readFile legge (e cancella) il report scritto da Vitest nel file scelto dall'host, mai in uno indicato dall'output.
func (p *reportParser) readFile() []idetesting.Event {
	defer os.Remove(p.file)
	data, err := os.ReadFile(p.file)
	if err != nil || len(data) > maxReportBytes {
		return nil
	}
	var report jsonReport
	if json.Unmarshal(data, &report) != nil || report.TestResults == nil {
		return nil
	}
	p.done = true
	return reportEvents(p.root, report)
}

var (
	// failureAt cerca il primo file:riga dello stack che non sia una dipendenza.
	failureAt = regexp.MustCompile(`([^\s()]+\.[cm]?[jt]sx?):(\d+):\d+`)
	// titleSlash non può comparire nei nomi: l'albero usa "/" per annidare describe e test.
	titleSlash = strings.NewReplacer("/", "∕")
)

func reportEvents(root string, report jsonReport) []idetesting.Event {
	var events []idetesting.Event
	for _, file := range report.TestResults {
		pkg := relativeSlash(root, file.Name)
		failed := file.Status == "failed"
		for _, test := range file.AssertionResults {
			parts := make([]string, 0, len(test.AncestorTitles)+1)
			for _, title := range append(append([]string(nil), test.AncestorTitles...), test.Title) {
				parts = append(parts, titleSlash.Replace(title))
			}
			name := strings.Join(parts, "/")
			events = append(events, idetesting.Event{Action: "run", Package: pkg, Test: name})
			action := "pass"
			switch test.Status {
			case "failed":
				action, failed = "fail", true
				text := strings.Join(test.FailureMessages, "\n")
				event := idetesting.Event{Action: "output", Package: pkg, Test: name, Output: text + "\n"}
				if location, ok := failureLocation(root, text); ok {
					event.Failure = &location
				}
				events = append(events, event)
			case "pending", "skipped", "todo", "disabled":
				action = "skip"
			}
			events = append(events, idetesting.Event{Action: action, Package: pkg, Test: name, Elapsed: test.Duration / 1000})
		}
		// Una suite che non parte (errore di import o di sintassi) non ha asserzioni: il messaggio è l'unica spiegazione.
		if failed && file.Message != "" {
			events = append(events, idetesting.Event{Action: "output", Package: pkg, Output: file.Message + "\n"})
		}
		action := "pass"
		if failed {
			action = "fail"
		}
		events = append(events, idetesting.Event{Action: action, Package: pkg, Elapsed: max(0, file.EndTime-file.StartTime) / 1000})
	}
	return events
}

func failureLocation(root, text string) (idetesting.TestLocation, bool) {
	for _, match := range failureAt.FindAllStringSubmatch(text, -1) {
		if strings.Contains(match[1], "node_modules") {
			continue
		}
		line := 0
		fmt.Sscanf(match[2], "%d", &line)
		return idetesting.TestLocation{File: match[1], RelativePath: relativeSlash(root, match[1]), Line: line}, true
	}
	return idetesting.TestLocation{}, false
}

func relativeSlash(root, path string) string {
	if relative, err := filepath.Rel(root, path); err == nil && !strings.HasPrefix(relative, "..") {
		return filepath.ToSlash(relative)
	}
	return filepath.ToSlash(path)
}
