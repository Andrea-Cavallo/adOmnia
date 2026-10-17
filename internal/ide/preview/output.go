package preview

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

// outputTail conserva le ultime righe dell'output di un dev server: servono a spiegare un fallimento.
type outputTail struct {
	mu      sync.Mutex
	lines   []string
	partial string
}

// Add accoda un blocco di output (stdout e stderr insieme).
func (t *outputTail) Add(data []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	text := t.partial + StripANSI(string(data))
	parts := strings.Split(text, "\n")
	t.partial = parts[len(parts)-1]
	if len(t.partial) > 2048 {
		t.partial = ""
	}
	for _, line := range parts[:len(parts)-1] {
		if line = strings.TrimRight(line, "\r"); strings.TrimSpace(line) != "" {
			t.lines = append(t.lines, line)
		}
	}
	if extra := len(t.lines) - outputTailLines; extra > 0 {
		t.lines = t.lines[extra:]
	}
}

// Text restituisce le righe conservate, con la riga in corso.
func (t *outputTail) Text() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.partial != "" {
		return strings.Join(append(append([]string(nil), t.lines...), t.partial), "\n")
	}
	return strings.Join(t.lines, "\n")
}

// classifyExit traduce l'uscita di un dev server in un tipo di problema e in un messaggio pulito
// per l'utente (niente dump del terminale: la console Run ha l'output completo).
func classifyExit(output string, exitCode int, wasReady bool) (kind, message string) {
	lower := strings.ToLower(output)
	switch {
	case strings.Contains(lower, "eaddrinuse") || strings.Contains(lower, "address already in use") ||
		strings.Contains(lower, "port") && strings.Contains(lower, "already in use") || strings.Contains(lower, "is already being used"):
		return FailurePortInUse, "The port the dev server needs is already in use. Stop the program using it, or stop the other preview, then try again."
	case strings.Contains(lower, "is not recognized as an internal or external command") || strings.Contains(lower, ": not found") ||
		strings.Contains(lower, "cannot find module") || strings.Contains(lower, "err_module_not_found") || strings.Contains(lower, "enoent"):
		return FailureMissingDeps, "The dev server could not start because a dependency is missing. Install the project dependencies and try again."
	case wasReady:
		return FailureExited, fmt.Sprintf("The dev server stopped (exit code %d).", exitCode)
	}
	return FailureExited, fmt.Sprintf("The dev server exited with code %d before it was ready. The Run console has the output.", exitCode)
}

func portOf(rawURL string) int {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return 0
	}
	port, _ := strconv.Atoi(parsed.Port())
	return port
}
