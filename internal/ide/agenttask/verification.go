package agenttask

import (
	"context"
	"encoding/json/jsontext"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"
)

// VerificationKind è il tipo di controllo eseguito da adOmnia sul contenuto del task.
type VerificationKind string

const (
	// VerificationTest esegue i test del linguaggio con l'adapter registrato.
	VerificationTest VerificationKind = "test"
	// VerificationRequest esegue una richiesta HTTP su un ambiente locale approvato.
	VerificationRequest VerificationKind = "request"
	// VerificationPage apre una pagina in un browser headless: screenshot, errori JS e richieste.
	VerificationPage VerificationKind = "page"
)

// VerificationHeader è un'intestazione HTTP della verifica, in ordine stabile.
type VerificationHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Verification è una verifica riutilizzabile del task. È una definizione, non un
// risultato: i risultati sono Evidence.
type Verification struct {
	ID    string           `json:"id"`
	Kind  VerificationKind `json:"kind"`
	Label string           `json:"label"`

	// Test del linguaggio.
	Language         string   `json:"language,omitempty"`
	WorkingDirectory string   `json:"workingDirectory,omitempty"`
	Packages         []string `json:"packages,omitempty"`
	Run              string   `json:"run,omitempty"`
	Coverage         bool     `json:"coverage,omitempty"`

	// Richiesta HTTP.
	Method         string               `json:"method,omitempty"`
	URL            string               `json:"url,omitempty"`
	Headers        []VerificationHeader `json:"headers,omitempty"`
	Body           string               `json:"body,omitempty"`
	ExpectedStatus int                  `json:"expectedStatus,omitempty"`
	// AllowRemote consente un host non locale. Vuoto significa: solo loopback.
	AllowRemote bool `json:"allowRemote,omitempty"`
	// SettleSeconds (pagina) è l'attesa dopo la navigazione prima dello screenshot.
	SettleSeconds int `json:"settleSeconds,omitempty"`
	// Service avvia nel workspace del task, prima della richiesta, una configurazione
	// di Run approvata dall'utente, e la ferma a fine verifica.
	Service ServiceLaunch `json:"service,omitzero"`
	// Watch elenca i topic del broker osservati durante la verifica (messaggi prodotti).
	Watch VerificationWatch `json:"watch,omitzero"`

	TimeoutSeconds int       `json:"timeoutSeconds"`
	CreatedAt      time.Time `json:"createdAt"`
	// ScenarioID/CriterionID link a verification to the acceptance criterion it executes.
	ScenarioID  string `json:"scenarioId,omitempty"`
	CriterionID string `json:"criterionId,omitempty"`
}

// VerificationDraft è ciò che arriva dal renderer: nessun ID, nessun timestamp.
type VerificationDraft struct {
	Kind             VerificationKind     `json:"kind"`
	Label            string               `json:"label"`
	Language         string               `json:"language,omitempty"`
	WorkingDirectory string               `json:"workingDirectory,omitempty"`
	Packages         []string             `json:"packages,omitempty"`
	Run              string               `json:"run,omitempty"`
	Coverage         bool                 `json:"coverage,omitempty"`
	Method           string               `json:"method,omitempty"`
	URL              string               `json:"url,omitempty"`
	Headers          []VerificationHeader `json:"headers,omitempty"`
	Body             string               `json:"body,omitempty"`
	ExpectedStatus   int                  `json:"expectedStatus,omitempty"`
	AllowRemote      bool                 `json:"allowRemote,omitempty"`
	SettleSeconds    int                  `json:"settleSeconds,omitempty"`
	Service          ServiceLaunch        `json:"service,omitzero"`
	Watch            VerificationWatch    `json:"watch,omitzero"`
	TimeoutSeconds   int                  `json:"timeoutSeconds,omitempty"`
}

// VerificationWatch è ciò che la verifica osserva mentre gira: i messaggi prodotti sui topic Kafka
// e le query eseguite su una connessione database salvata. Solo indirizzi e un riferimento opaco
// alla connessione, nessuna credenziale: i broker non locali richiedono AllowRemote.
type VerificationWatch struct {
	Brokers []string `json:"brokers,omitempty"`
	Topics  []string `json:"topics,omitempty"`
	// Database è l'ID di una connessione salvata in Database; le credenziali restano in Go.
	Database string `json:"database,omitempty"`
}

// Enabled dice se la verifica osserva dei topic.
func (watch VerificationWatch) Enabled() bool { return len(watch.Topics) > 0 }

const maxWatchedTopics = 10

func normalizeWatch(watch VerificationWatch, allowRemote bool) (VerificationWatch, error) {
	clean := func(values []string) []string {
		var out []string
		for _, value := range values {
			if value = strings.TrimSpace(value); value != "" {
				out = append(out, value)
			}
		}
		return out
	}
	watch = VerificationWatch{Brokers: clean(watch.Brokers), Topics: clean(watch.Topics), Database: strings.TrimSpace(watch.Database)}
	if len(watch.Database) > 128 {
		return VerificationWatch{}, errors.New("database connection reference is too long")
	}
	if !watch.Enabled() {
		return VerificationWatch{Database: watch.Database}, nil
	}
	if len(watch.Topics) > maxWatchedTopics {
		return VerificationWatch{}, fmt.Errorf("at most %d topics can be watched", maxWatchedTopics)
	}
	if len(watch.Brokers) == 0 {
		return VerificationWatch{}, errors.New("watched topics need a broker address")
	}
	for _, broker := range watch.Brokers {
		host, _, err := net.SplitHostPort(broker)
		if err != nil {
			return VerificationWatch{}, fmt.Errorf("broker %q must be host:port", broker)
		}
		if !allowRemote && !IsLoopbackHost(host) {
			return VerificationWatch{}, fmt.Errorf("broker %q is not local: approve remote hosts on the verification first", broker)
		}
	}
	return watch, nil
}

// ServiceLaunch è la configurazione di Run che una verifica avvia prima della richiesta.
// Configuration è lo snapshot JSON approvato dall'utente, senza valori segreti: il core non ne
// conosce il formato, l'host lo traduce con gli stessi servizi del pannello Run.
type ServiceLaunch struct {
	Name                string `json:"name,omitempty"`
	Configuration       string `json:"configuration,omitempty"`
	ReadyTimeoutSeconds int    `json:"readyTimeoutSeconds,omitempty"`
}

// Enabled dice se la verifica avvia un servizio.
func (launch ServiceLaunch) Enabled() bool { return strings.TrimSpace(launch.Configuration) != "" }

const (
	maxServiceConfiguration = 64 * 1024
	defaultServiceReady     = 60
	maxServiceReady         = 300
)

func normalizeServiceLaunch(launch ServiceLaunch) (ServiceLaunch, error) {
	if !launch.Enabled() {
		return ServiceLaunch{}, nil
	}
	if len(launch.Configuration) > maxServiceConfiguration || !jsontext.Value(launch.Configuration).IsValid() {
		return ServiceLaunch{}, errors.New("the run configuration to start is not valid")
	}
	launch.Name = strings.TrimSpace(launch.Name)
	if launch.Name == "" {
		return ServiceLaunch{}, errors.New("the run configuration to start needs a name")
	}
	if launch.ReadyTimeoutSeconds == 0 {
		launch.ReadyTimeoutSeconds = defaultServiceReady
	}
	if launch.ReadyTimeoutSeconds < 1 || launch.ReadyTimeoutSeconds > maxServiceReady {
		return ServiceLaunch{}, fmt.Errorf("the service must become ready within 1 and %d seconds", maxServiceReady)
	}
	return launch, nil
}

const (
	maxVerificationsPerTask = 20
	maxEvidencePerTask      = 100
	maxVerificationLabel    = 120
	maxVerificationBody     = 16 * 1024
	maxVerificationHeaders  = 40
	maxVerificationTimeout  = 600
)

func normalizeVerificationDraft(draft VerificationDraft) (VerificationDraft, error) {
	draft.Label = strings.TrimSpace(draft.Label)
	draft.Language = strings.TrimSpace(draft.Language)
	draft.WorkingDirectory = strings.TrimSpace(draft.WorkingDirectory)
	draft.Method = strings.ToUpper(strings.TrimSpace(draft.Method))
	draft.URL = strings.TrimSpace(draft.URL)
	switch draft.Kind {
	case VerificationTest:
		if draft.Language == "" {
			draft.Language = "go"
		}
		if draft.WorkingDirectory != "" {
			cleaned := strings.ReplaceAll(draft.WorkingDirectory, "\\", "/")
			if strings.HasPrefix(cleaned, "/") || strings.HasPrefix(cleaned, "../") || cleaned == ".." {
				return VerificationDraft{}, errors.New("working directory must stay inside the workspace")
			}
			draft.WorkingDirectory = cleaned
		}
		if len(draft.Packages) > 64 {
			return VerificationDraft{}, errors.New("too many test packages")
		}
		for _, expression := range draft.Packages {
			if strings.HasPrefix(strings.TrimSpace(expression), "-") {
				return VerificationDraft{}, fmt.Errorf("invalid test package %q", expression)
			}
		}
		if draft.TimeoutSeconds == 0 {
			draft.TimeoutSeconds = 120
		}
		if draft.Label == "" {
			draft.Label = "Language tests"
		}
	case VerificationRequest:
		if draft.Method == "" {
			draft.Method = "GET"
		}
		parsed, err := url.Parse(draft.URL)
		if err != nil || parsed.Host == "" {
			return VerificationDraft{}, errors.New("an absolute URL is required for a request verification")
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return VerificationDraft{}, errors.New("only http and https requests can be verified")
		}
		if draft.ExpectedStatus == 0 {
			draft.ExpectedStatus = 200
		}
		if draft.ExpectedStatus < 100 || draft.ExpectedStatus > 599 {
			return VerificationDraft{}, errors.New("expected status must be between 100 and 599")
		}
		if len(draft.Headers) > maxVerificationHeaders {
			return VerificationDraft{}, errors.New("too many headers")
		}
		for _, header := range draft.Headers {
			if strings.TrimSpace(header.Name) == "" || strings.ContainsAny(header.Name, ":\r\n") {
				return VerificationDraft{}, errors.New("invalid header name")
			}
		}
		if len(draft.Body) > maxVerificationBody {
			return VerificationDraft{}, errors.New("request body exceeds 16 KiB")
		}
		if draft.TimeoutSeconds == 0 {
			draft.TimeoutSeconds = 30
		}
		if draft.Label == "" {
			draft.Label = draft.Method + " " + parsed.Host + parsed.Path
		}
		if draft.Service, err = normalizeServiceLaunch(draft.Service); err != nil {
			return VerificationDraft{}, err
		}
		if draft.Watch, err = normalizeWatch(draft.Watch, draft.AllowRemote); err != nil {
			return VerificationDraft{}, err
		}
		// Il servizio avviato da adOmnia gira su questa macchina: la richiesta resta locale.
		if draft.Service.Enabled() && !draft.AllowRemote && !IsLoopbackHost(parsed.Hostname()) {
			return VerificationDraft{}, errors.New("a request to a service started by adOmnia must target a loopback host")
		}
	case VerificationPage:
		draft.Method = "GET"
		parsed, err := url.Parse(draft.URL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return VerificationDraft{}, errors.New("an absolute http or https URL is required for a page verification")
		}
		if draft.SettleSeconds == 0 {
			draft.SettleSeconds = 2
		}
		if draft.SettleSeconds < 1 || draft.SettleSeconds > 30 {
			return VerificationDraft{}, errors.New("the page must settle within 1 and 30 seconds")
		}
		if draft.TimeoutSeconds == 0 {
			draft.TimeoutSeconds = 60
		}
		if draft.Label == "" {
			draft.Label = "Page " + parsed.Host + parsed.Path
		}
		if draft.Service, err = normalizeServiceLaunch(draft.Service); err != nil {
			return VerificationDraft{}, err
		}
		if draft.Service.Enabled() && !draft.AllowRemote && !IsLoopbackHost(parsed.Hostname()) {
			return VerificationDraft{}, errors.New("a page served by adOmnia must use a loopback host")
		}
	default:
		return VerificationDraft{}, errors.New("verification kind must be test, request or page")
	}
	if len(draft.Label) > maxVerificationLabel {
		return VerificationDraft{}, errors.New("verification label is too long")
	}
	if draft.TimeoutSeconds < 1 {
		draft.TimeoutSeconds = 1
	}
	if draft.TimeoutSeconds > maxVerificationTimeout {
		return VerificationDraft{}, fmt.Errorf("timeout must be at most %d seconds", maxVerificationTimeout)
	}
	return draft, nil
}

// EvidenceOutcome distingue un controllo superato da uno fallito, non eseguito o
// interrotto da un errore: un dato non raccolto non diventa mai "superato".
type EvidenceOutcome string

const (
	EvidencePassed EvidenceOutcome = "passed"
	EvidenceFailed EvidenceOutcome = "failed"
	EvidenceError  EvidenceOutcome = "error"
	EvidenceNotRun EvidenceOutcome = "not_run"
)

// Observation è un fatto misurato durante la verifica (stato HTTP, durata, ambiente).
type Observation struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Evidence è il risultato registrato di una verifica: cosa è stato eseguito, su quale
// contenuto, con quale esito, log e osservazioni. È l'unità che la review mostra accanto al diff.
type Evidence struct {
	ID             string           `json:"id"`
	TaskID         string           `json:"taskId"`
	AttemptID      string           `json:"attemptId,omitempty"`
	VerificationID string           `json:"verificationId"`
	Kind           VerificationKind `json:"kind"`
	Label          string           `json:"label"`
	Outcome        EvidenceOutcome  `json:"outcome"`
	// Command è il comando eseguito o "METHOD URL": permette di riprodurre la verifica.
	Command     string `json:"command"`
	Environment string `json:"environment,omitempty"`
	Workdir     string `json:"workdir,omitempty"`
	// DiffFingerprint identifica il contenuto misurato; ChangedFiles ne è la dimensione.
	DiffFingerprint string        `json:"diffFingerprint,omitempty"`
	ChangedFiles    int           `json:"changedFiles"`
	ExitCode        *int          `json:"exitCode,omitempty"`
	DurationMs      int64         `json:"durationMs"`
	StartedAt       time.Time     `json:"startedAt"`
	FinishedAt      time.Time     `json:"finishedAt"`
	Log             string        `json:"log,omitempty"`
	Truncated       bool          `json:"truncated,omitempty"`
	Observations    []Observation `json:"observations,omitempty"`
}

// VerifyRequest è ciò che il Verifier riceve: il task non viene eseguito dal Verifier.
type VerifyRequest struct {
	TaskID       string
	AttemptID    string
	Workdir      string
	Verification Verification
}

// Verifier esegue una verifica con gli strumenti esistenti dello strumento corrispondente.
// Implementato dall'host (test del linguaggio, richiesta HTTP); il core non duplica i servizi.
type Verifier interface {
	Run(context.Context, VerifyRequest) Evidence
}

// IsLoopbackHost accetta solo indirizzi letterali di loopback o "localhost": risolvere
// un nome richiederebbe già una chiamata di rete, che la verifica fa solo dopo l'approvazione.
func IsLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}
