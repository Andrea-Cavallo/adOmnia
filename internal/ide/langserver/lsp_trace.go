package langserver

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"
)

// slowProgress: oltre questa durata una fase del server (es. "Setting up workspace" di gopls) è
// lenta abbastanza da meritare nel log le cause da controllare.
const slowProgress = time.Minute

// Motivi di avvio scritti nel log: dicono perché il server rifà il caricamento del workspace.
const (
	launchReasonStart   = "first start"
	launchReasonResume  = "resume after memory-pressure hibernation"
	launchReasonCrash   = "automatic restart after a crash"
	launchReasonRestart = "explicit restart"
)

// progressTrace è una fase $/progress aperta dal server: serve a misurarne la durata.
type progressTrace struct {
	title   string
	message string
	started time.Time
}

// trace scrive una riga nel log del server (finestra Language Server Log) e nel log dell'app.
func (m *LSPManager) trace(state *lspSession, format string, args ...any) {
	line := fmt.Sprintf(format, args...)
	m.appendLog(state, line)
	state.mu.Lock()
	name, session := state.options.DisplayName(), state.id
	state.mu.Unlock()
	log.Printf("[lsp] %s %s: %s", name, session, line)
}

// traceLaunch descrive l'avvio: motivo, eseguibile, cartelle del workspace e ambiente rilevante.
func (m *LSPManager) traceLaunch(state *lspSession, reason string) {
	state.mu.Lock()
	options, root, folders := state.options, state.root, append([]string(nil), state.folders...)
	state.mu.Unlock()
	if len(folders) == 0 {
		folders = []string{root}
	}
	m.trace(state, "starting (%s): %s %s, root %s, %d workspace folder(s): %s", reason, options.Binary, options.Version, root, len(folders), strings.Join(folders, ", "))
	if env := traceEnvironment(options.Environment, options.TraceEnvironment); env != "" {
		m.trace(state, "environment: %s", env)
	}
}

// traceEnvironment riporta solo le chiavi richieste dall'adapter; le credenziali negli URL non escono.
func traceEnvironment(environment, keys []string) string {
	if len(keys) == 0 {
		return ""
	}
	values := map[string]string{}
	for _, entry := range environment {
		if key, value, ok := strings.Cut(entry, "="); ok {
			values[strings.ToUpper(key)] = value
		}
	}
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		value, ok := values[strings.ToUpper(key)]
		if !ok || value == "" {
			value = "(default)"
		}
		parts = append(parts, key+"="+redactCredentials(value))
	}
	return strings.Join(parts, " ")
}

// redactCredentials oscura utente e password negli URL (es. GOPROXY=https://user:token@proxy).
func redactCredentials(value string) string {
	items := strings.Split(value, ",")
	for index, item := range items {
		parsed, err := url.Parse(item)
		if err == nil && parsed.User != nil {
			parsed.User = url.User("***")
			items[index] = parsed.String()
		}
	}
	return strings.Join(items, ",")
}

// traceProgress misura le fasi $/progress: inizio, messaggi nuovi e durata alla fine.
func (m *LSPManager) traceProgress(state *lspSession, token string, value progressValue) {
	now := time.Now()
	state.mu.Lock()
	if state.progress == nil {
		state.progress = map[string]progressTrace{}
	}
	phase, known := state.progress[token]
	sinceStart := now.Sub(state.startedAt)
	changed := known && value.Message != "" && value.Message != phase.message
	switch value.Kind {
	case "begin":
		phase = progressTrace{title: value.Title, message: value.Message, started: now}
		state.progress[token] = phase
	case "report":
		if changed {
			phase.message = value.Message
			state.progress[token] = phase
		}
	case "end":
		delete(state.progress, token)
	}
	state.mu.Unlock()
	switch {
	case value.Kind == "begin":
		m.trace(state, "▶ %s%s (%s after start)", phase.title, suffix(value.Message), round(sinceStart))
	case value.Kind == "report" && changed:
		m.trace(state, "… %s: %s (%s)", phase.title, value.Message, round(now.Sub(phase.started)))
	case value.Kind == "end" && known:
		elapsed := now.Sub(phase.started)
		m.trace(state, "✔ %s done in %s%s (%s after start)", phase.title, round(elapsed), suffix(value.Message), round(sinceStart))
		if elapsed >= slowProgress {
			m.trace(state, "slow %q: %s. Check the workspace folders above (one folder per module, no large non-Go trees), module downloads (GOPROXY/GOFLAGS, network) and antivirus scanning of GOCACHE/GOMODCACHE.", phase.title, round(elapsed))
		}
	}
}

func suffix(message string) string {
	if message == "" {
		return ""
	}
	return ": " + message
}

func round(duration time.Duration) time.Duration {
	if duration < time.Second {
		return duration.Round(time.Millisecond)
	}
	return duration.Round(100 * time.Millisecond)
}

// progressValue estrae i campi di $/progress usati sia dalla UI sia dal log.
type progressValue struct {
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Message    string `json:"message"`
	Percentage *int   `json:"percentage"`
}

func parseProgress(params jsonv1.RawMessage) (string, progressValue, bool) {
	var envelope struct {
		Token jsonv1.RawMessage `json:"token"`
		Value progressValue     `json:"value"`
	}
	if json.Unmarshal(params, &envelope) != nil || envelope.Value.Kind == "" {
		return "", progressValue{}, false
	}
	return strings.Trim(string(envelope.Token), `"`), envelope.Value, true
}
