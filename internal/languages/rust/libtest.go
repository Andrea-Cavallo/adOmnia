package rust

import (
	"regexp"
	"strings"

	idetesting "adomnia/internal/ide/testing"
)

// libtestParser legge l'output umano di `cargo test` (libtest) e lo traduce in eventi testing. Non
// fa parsing del colore: i nomi dei test arrivano dalle righe `test <nome> ... esito`, i fallimenti
// dalla sezione `---- <nome> stdout ----` e dalla riga `thread '<nome>' panicked at file:riga`
// (RS-5.3, fallback dichiarato della decisione RS-0.3 quando cargo-nextest non c'è).
type libtestParser struct {
	paths   workspacePaths // risolve i percorsi dei panic (relativi alla radice del workspace)
	pkg     string         // crate di default (il package della cartella, o il nome della cartella)
	current string         // crate del target in esecuzione: in un workspace cambia a ogni `Running`
	unit    string         // contesto corrente: "" (unittests), "tests/foo.rs" o "doctest"
	inOut   string         // nome del test di cui stiamo leggendo lo stdout/stderr ("" = fuori)
	// Coverage opzionale (RS-5.6): il report LCOV che cargo-llvm-cov scrive a fine run.
	coveragePath  string
	coverage      *idetesting.CoverageReport
	coverageRead  bool
}

var (
	libtestRunning = regexp.MustCompile(`^running \d+ tests?$`)
	libtestResult  = regexp.MustCompile(`^test (.+?) \.\.\. (ok|FAILED|ignored)$`)
	libtestUnit    = regexp.MustCompile(`^\s*Running\s+(?:unittests\s+)?(\S+)\s+\(([^)]*)\)`)
	libtestDoc     = regexp.MustCompile(`^\s*Doc-tests\s+(\S+)`)
	libtestOutput  = regexp.MustCompile(`^---- (.+?) (stdout|stderr) ----$`)
	libtestPanic   = regexp.MustCompile(`^thread '(.+?)' panicked at (.+?):(\d+):(\d+)`)
	rustError      = regexp.MustCompile(`^error(\[E\d+\])?:\s*(.*)$`)
)

// Parse interpreta una riga. Le righe non riconosciute vengono ignorate (restano nell'output grezzo).
func (p *libtestParser) Parse(line []byte) (idetesting.Event, bool) {
	text := strings.TrimRight(string(line), "\r\n")
	// Una riga di confine (nuovo blocco `----`, sezione o esito) chiude il blocco output corrente:
	// la riga viene rielaborata dal resto di Parse (così `---- stderr ----` apre il blocco stderr).
	if p.inOut != "" && outputBoundary(text) {
		p.inOut = ""
	}
	if p.inOut != "" {
		return p.parseOutput(text)
	}
	switch {
	case libtestUnit.MatchString(text):
		p.enterTarget(text)
		return idetesting.Event{}, false
	case libtestDoc.MatchString(text):
		p.unit = "doctest"
		p.current = libtestDoc.FindStringSubmatch(text)[1]
		return idetesting.Event{}, false
	case libtestRunning.MatchString(text), strings.HasPrefix(text, "Compiling"), strings.HasPrefix(text, "Finished"), strings.HasPrefix(text, "Fresh"):
		return idetesting.Event{}, false
	case strings.HasPrefix(text, "error"):
		if m := rustError.FindStringSubmatch(text); m != nil {
			return idetesting.Event{Action: "build-output", Package: p.crate(), Output: text + "\n"}, true
		}
		return idetesting.Event{}, false
	}
	if m := libtestResult.FindStringSubmatch(text); m != nil {
		action := map[string]string{"ok": "pass", "FAILED": "fail", "ignored": "skip"}[m[2]]
		return idetesting.Event{Action: action, Package: p.crate(), Test: p.testName(m[1])}, true
	}
	if m := libtestOutput.FindStringSubmatch(text); m != nil {
		p.inOut = m[1]
		return idetesting.Event{}, false
	}
	return idetesting.Event{}, false
}

// Finish implementa idetesting.Finisher: l'output libtest non tiene test "in corso" (ogni riga
// `test … ok|FAILED|ignored` è un esito definitivo, e la riga `running N tests` dà solo il conteggio
// senza nomi), quindi alla chiusura del processo non c'è nulla da chiudere come skip (RS-5.4, a
// differenza di pytest che ha una fase di collect con nodi "running").
func (*libtestParser) Finish() []idetesting.Event { return nil }

// outputBoundary dice se una riga chiude il blocco output corrente: un nuovo blocco `----`, una
// sezione (`test result:`/`failures:`/`running …`) oppure l'inizio di un nuovo esito. Una riga vuota
// non è un confine: fa parte dell'output del test e non lo tronca.
func outputBoundary(text string) bool {
	return strings.HasPrefix(text, "----") ||
		strings.HasPrefix(text, "test result:") ||
		strings.HasPrefix(text, "running ") ||
		strings.HasPrefix(text, "failures:")
}

// parseOutput gestisce una riga dentro un blocco `---- <nome> stdout ----`: la riga del panic
// fornisce la posizione del fallimento. Il confine è gestito da Parse via outputBoundary.
func (p *libtestParser) parseOutput(text string) (idetesting.Event, bool) {
	event := idetesting.Event{Action: "output", Package: p.crate(), Test: p.testName(p.inOut), Output: text + "\n"}
	if m := libtestPanic.FindStringSubmatch(text); m != nil {
		file := m[2]
		if fixed := p.paths.resolve(file); fixed != "" {
			file = fixed
		}
		// Il frontend apre il fallimento per `relativePath` (relativo alla radice del progetto):
		// senza questo campo il click sulla riga del panic non navigava (RS-5.5).
		event.Failure = &idetesting.TestLocation{File: file, RelativePath: p.paths.rootRelative(file), Line: atoiOrZero(m[3])}
	}
	return event, true
}

// testName normalizza il nome: `tests::it_works` → `tests/it_works` (modulo → albero), e i test di
// integrazione/doctest sono prefissati dal loro contesto per non confonderli con gli unit test.
func (p *libtestParser) testName(name string) string {
	normalized := strings.ReplaceAll(name, "::", "/")
	if p.unit == "" || p.unit == "doctest" {
		return normalized
	}
	return p.unit + "/" + normalized
}

// enterTarget legge `Running unittests src/lib.rs (target/debug/deps/api-1a2b.exe)` o
// `Running tests/api.rs (…)`. Per un membro di workspace cargo stampa il percorso relativo al
// *membro*, quindi il crate si ricava, in ordine: dalla cartella nel percorso (se cargo lo stampa
// dalla radice), dal nome dell'eseguibile degli unit test, altrimenti resta quello del target
// precedente (cargo esegue unit test e test di integrazione dello stesso package di seguito).
// Il contesto è "" per gli unit test o `tests/<file>.rs` per un test di integrazione.
func (p *libtestParser) enterTarget(line string) {
	match := libtestUnit.FindStringSubmatch(line)
	path := strings.ReplaceAll(match[1], `\`, "/")
	unitTests := strings.Contains(line, "unittests")
	p.unit = ""
	crateDirectory := ""
	if unitTests {
		crateDirectory = beforeSegment(path, "src")
	} else if index := strings.LastIndex("/"+path, "/tests/"); index >= 0 {
		crateDirectory = strings.TrimSuffix(path[:max(0, index-1)], "/")
		p.unit = path[max(0, index):]
	}
	switch {
	case crateDirectory != "":
		p.current = crateDirectory[strings.LastIndex(crateDirectory, "/")+1:]
	case unitTests:
		p.current = crateFromExecutable(match[2])
	}
}

var executableHash = regexp.MustCompile(`-[0-9a-f]{8,}$`)

// crateFromExecutable estrae il crate da `target/debug/deps/api-1a2b3c4d5e6f7a8b.exe`.
func crateFromExecutable(executable string) string {
	name := strings.ReplaceAll(executable, `\`, "/")
	name = name[strings.LastIndex(name, "/")+1:]
	return executableHash.ReplaceAllString(strings.TrimSuffix(name, ".exe"), "")
}

// beforeSegment restituisce il percorso prima dell'ultimo segmento `segment/` ("" se è il primo).
func beforeSegment(path, segment string) string {
	index := strings.LastIndex("/"+path, "/"+segment+"/")
	if index <= 0 {
		return ""
	}
	return path[:index-1]
}

// crate è il nome del crate a cui appartengono gli eventi correnti: quello del target in corso, se
// il workspace lo ha rivelato, altrimenti il package della cartella.
func (p *libtestParser) crate() string {
	if p.current != "" {
		return p.current
	}
	return p.pkg
}

func atoiOrZero(value string) int {
	number := 0
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return 0
		}
		number = number*10 + int(digit-'0')
	}
	return number
}
