package goide

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"adomnia/internal/netpolicy"

	"github.com/google/pprof/profile"
)

// Profili catturati da un servizio in esecuzione che espone net/http/pprof. Sono gli unici modi per
// avere goroutine e threadcreate (go test non ha un flag per loro) e servono anche per heap/CPU di
// un servizio vivo invece che dei suoi test. Solo loopback: è il servizio dell'utente su questa macchina.

const (
	defaultCPUCaptureSeconds = 10
	maxCPUCaptureSeconds     = 60
	// Una trace di esecuzione pesa molto più di un profilo: pochi secondi bastano a vedere scheduler e GC.
	defaultTraceCaptureSeconds = 5
	liveProfileTimeout         = 20 * time.Second
)

// liveProfileFiles è il nome dell'endpoint pprof → prefisso del file salvato (profileKind lo riconosce).
var liveProfileFiles = map[string]string{
	"goroutine":    "goroutine",
	"threadcreate": "threadcreate",
	"heap":         "heap",
	"allocs":       "heap-allocs",
	"block":        "block",
	"mutex":        "mutex",
	"profile":      "cpu",
}

// LiveProfileRequest descrive la cattura: URL del servizio (es. http://localhost:6060), tipo di profilo
// (nome dell'endpoint /debug/pprof/<kind>) e durata in secondi solo per il CPU profile.
type LiveProfileRequest struct {
	SessionID string `json:"sessionId"`
	URL       string `json:"url"`
	Kind      string `json:"kind"`
	Seconds   int    `json:"seconds,omitempty"`
}

// CaptureLiveProfile scarica un profilo da /debug/pprof di un servizio locale, verifica che sia pprof
// valido e lo salva nella radice del progetto, pronto per il Performance Studio.
func (s *Service) CaptureLiveProfile(ctx context.Context, request LiveProfileRequest) (ProfileFile, error) {
	session, err := s.session(request.SessionID)
	if err != nil {
		return ProfileFile{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return ProfileFile{}, fmt.Errorf("autorizza il progetto prima di salvare profili al suo interno")
	}
	prefix, ok := liveProfileFiles[request.Kind]
	if !ok {
		return ProfileFile{}, fmt.Errorf("tipo di profilo non supportato: %q", request.Kind)
	}
	endpoint, timeout, err := liveProfileEndpoint(request)
	if err != nil {
		return ProfileFile{}, err
	}
	data, err := fetchLiveProfile(ctx, endpoint, timeout)
	if err != nil {
		return ProfileFile{}, err
	}
	if _, err := profile.ParseData(data); err != nil {
		return ProfileFile{}, fmt.Errorf("la risposta di %s non è un profilo pprof: %w", endpoint, err)
	}
	root := session.Project.RealPath
	name := fmt.Sprintf("%s-%s.pprof", prefix, time.Now().Format("20060102-150405"))
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return ProfileFile{}, fmt.Errorf("salvataggio del profilo fallito: %w", err)
	}
	return ProfileFile{Path: path, Relative: relativeWithin(root, path), Name: name, Kind: profileKind(name), Size: int64(len(data)), Modified: time.Now().UTC().Format(time.RFC3339)}, nil
}

// liveProfileEndpoint costruisce l'URL /debug/pprof/<kind> accettando sia la radice del servizio sia
// un URL che contiene già /debug/pprof. Rifiuta host non locali.
func liveProfileEndpoint(request LiveProfileRequest) (string, time.Duration, error) {
	raw := strings.TrimSpace(request.URL)
	if raw == "" {
		return "", 0, fmt.Errorf("indica l'indirizzo del servizio, es. http://localhost:6060")
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", 0, fmt.Errorf("indirizzo non valido: %q", request.URL)
	}
	if host := parsed.Hostname(); !netpolicy.IsLocalHost(host) {
		return "", 0, fmt.Errorf("solo servizi su questa macchina (localhost): %s non è locale", host)
	}
	base := strings.TrimRight(parsed.Path, "/")
	if index := strings.Index(base, "/debug/pprof"); index >= 0 {
		base = base[:index]
	}
	parsed.Path = base + "/debug/pprof/" + request.Kind
	parsed.RawQuery, parsed.Fragment = "", ""
	timeout := liveProfileTimeout
	if request.Kind == "profile" || request.Kind == "trace" {
		seconds := request.Seconds
		if seconds <= 0 {
			seconds = defaultCPUCaptureSeconds
			if request.Kind == "trace" {
				seconds = defaultTraceCaptureSeconds
			}
		}
		seconds = min(seconds, maxCPUCaptureSeconds)
		parsed.RawQuery = url.Values{"seconds": {fmt.Sprint(seconds)}}.Encode()
		timeout += time.Duration(seconds) * time.Second
	}
	return parsed.String(), timeout, nil
}

func fetchLiveProfile(ctx context.Context, endpoint string, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	// Loopback: niente proxy aziendale anche se configurato.
	client := &http.Client{Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext}}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("servizio non raggiungibile su %s: avvialo e importa net/http/pprof (%w)", endpoint, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s ha risposto %s: il servizio espone net/http/pprof?", endpoint, response.Status)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxProfileSize+1))
	if err != nil {
		return nil, fmt.Errorf("lettura del profilo interrotta: %w", err)
	}
	if len(data) > maxProfileSize {
		return nil, fmt.Errorf("profilo troppo grande (max 512 MB)")
	}
	return data, nil
}
