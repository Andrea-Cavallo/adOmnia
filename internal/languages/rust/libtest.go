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
	pkg   string
	unit  string // contesto corrente: "" (unittests), "tests/foo.rs" o "doctest"
	inOut string // nome del test di cui stiamo leggendo lo stdout/stderr ("" = fuori)
}

var (
	libtestRunning = regexp.MustCompile(`^running \d+ tests?$`)
	libtestResult  = regexp.MustCompile(`^test (.+?) \.\.\. (ok|FAILED|ignored)$`)
	libtestUnit    = regexp.MustCompile(`^\s*Running\s+(unittests|tests/[^\s(]+)`)
	libtestDoc     = regexp.MustCompile(`^\s*Doc-tests\s+`)
	libtestOutput  = regexp.MustCompile(`^---- (.+?) (stdout|stderr) ----$`)
	libtestPanic   = regexp.MustCompile(`^thread '(.+?)' panicked at (.+?):(\d+):(\d+)`)
	rustError      = regexp.MustCompile(`^error(\[E\d+\])?:\s*(.*)$`)
)

// Parse interpreta una riga. Le righe non riconosciute vengono ignorate (restano nell'output grezzo).
func (p *libtestParser) Parse(line []byte) (idetesting.Event, bool) {
	text := strings.TrimRight(string(line), "\r\n")
	if p.inOut != "" {
		return p.parseOutput(text)
	}
	switch {
	case libtestUnit.MatchString(text):
		p.unit = unitOf(text)
		return idetesting.Event{}, false
	case libtestDoc.MatchString(text):
		p.unit = "doctest"
		return idetesting.Event{}, false
	case libtestRunning.MatchString(text), strings.HasPrefix(text, "Compiling"), strings.HasPrefix(text, "Finished"), strings.HasPrefix(text, "Fresh"):
		return idetesting.Event{}, false
	case strings.HasPrefix(text, "error"):
		if m := rustError.FindStringSubmatch(text); m != nil {
			return idetesting.Event{Action: "build-output", Package: p.pkg, Output: text + "\n"}, true
		}
		return idetesting.Event{}, false
	}
	if m := libtestResult.FindStringSubmatch(text); m != nil {
		action := map[string]string{"ok": "pass", "FAILED": "fail", "ignored": "skip"}[m[2]]
		return idetesting.Event{Action: action, Package: p.pkg, Test: p.testName(m[1])}, true
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

// parseOutput gestisce una riga dentro un blocco `---- <nome> stdout ----`: la prima riga vuota o
// una nuova sezione chiude il blocco; la riga del panic fornisce la posizione del fallimento.
func (p *libtestParser) parseOutput(text string) (idetesting.Event, bool) {
	if text == "" || strings.HasPrefix(text, "----") || strings.HasPrefix(text, "test result:") || strings.HasPrefix(text, "running ") {
		p.inOut = ""
		return idetesting.Event{}, false
	}
	event := idetesting.Event{Action: "output", Package: p.pkg, Test: p.testName(p.inOut), Output: text + "\n"}
	if m := libtestPanic.FindStringSubmatch(text); m != nil {
		event.Failure = &idetesting.TestLocation{File: m[2], Line: atoiOrZero(m[3])}
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

// unitOf estrae il contesto da `Running unittests src/lib.rs` → "" (unittests) o `tests/foo.rs`.
func unitOf(line string) string {
	if strings.Contains(line, "unittests") {
		return ""
	}
	if m := libtestUnit.FindStringSubmatch(line); m != nil && m[1] != "unittests" {
		return m[1]
	}
	return ""
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
