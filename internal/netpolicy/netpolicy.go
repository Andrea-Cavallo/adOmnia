// Package netpolicy è la politica di rete unica di adOmnia: modo offline, proxy e CA aziendali
// validi per tutta l'app (AI, client HTTP, Git, toolchain Go) e il registro locale delle
// connessioni che adOmnia apre da sola. Nessun dato lascia la macchina: il registro vive in memoria.
package netpolicy

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/http/httpproxy"
)

const settingsFileName = "network.json"

// Settings è la configurazione di rete di adOmnia. Non contiene segreti: una password nel proxy
// URL è rifiutata, le credenziali vanno nel gestore credenziali di sistema.
type Settings struct {
	// Offline blocca ogni connessione che adOmnia avvia da sola verso host non locali: AI cloud,
	// controllo aggiornamenti, vulncheck, download di toolchain e moduli Go, API dei Git host.
	// Le richieste che l'utente invia dal client API restano libere.
	Offline bool `json:"offline"`
	// ProxyURL è il proxy aziendale per tutta l'app; vuoto = HTTPS_PROXY/HTTP_PROXY del sistema.
	ProxyURL string `json:"proxyUrl"`
	// NoProxy elenca gli host raggiunti direttamente (sintassi NO_PROXY).
	NoProxy string `json:"noProxy"`
	// CABundlePath aggiunge un bundle PEM di CA aziendali ai certificati di sistema.
	CABundlePath string `json:"caBundlePath"`
}

// ErrOffline è l'errore restituito per una connessione bloccata dal modo offline.
var ErrOffline = errors.New("adOmnia is in offline mode: turn it off in Settings → Privacy & Data to connect")

var (
	mu       sync.RWMutex
	current  Settings
	filePath string
)

// Configure carica directory/network.json; un file assente o illeggibile vale i default.
func Configure(directory string) {
	mu.Lock()
	defer mu.Unlock()
	filePath = filepath.Join(directory, settingsFileName)
	current = Settings{}
	if data, err := os.ReadFile(filePath); err == nil {
		var loaded Settings
		if json.Unmarshal(data, &loaded) == nil {
			if normalized, err := loaded.Validate(); err == nil {
				current = normalized
			}
		}
	}
}

// Current restituisce le impostazioni attive.
func Current() Settings {
	mu.RLock()
	defer mu.RUnlock()
	return current
}

// Save valida, applica e salva le impostazioni.
func Save(settings Settings) (Settings, error) {
	normalized, err := settings.Validate()
	if err != nil {
		return Settings{}, err
	}
	mu.Lock()
	defer mu.Unlock()
	if filePath != "" {
		data, _ := json.MarshalIndent(normalized, "", "  ")
		if err := os.WriteFile(filePath, data, 0o600); err != nil {
			return Settings{}, fmt.Errorf("cannot save network settings: %w", err)
		}
	}
	current = normalized
	return normalized, nil
}

// Validate normalizza gli spazi e verifica proxy e bundle CA.
func (s Settings) Validate() (Settings, error) {
	s.ProxyURL = strings.TrimSpace(s.ProxyURL)
	s.NoProxy = strings.TrimSpace(s.NoProxy)
	s.CABundlePath = strings.TrimSpace(s.CABundlePath)
	if s.ProxyURL != "" {
		parsed, err := url.Parse(s.ProxyURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https" && parsed.Scheme != "socks5") {
			return Settings{}, errors.New("proxy must be an http://, https:// or socks5:// URL, for example http://proxy.corp:8080")
		}
		if _, hasPassword := parsed.User.Password(); hasPassword {
			return Settings{}, errors.New("do not put a password in the proxy URL: it would be saved in clear text")
		}
	}
	if s.CABundlePath != "" {
		if !filepath.IsAbs(s.CABundlePath) {
			return Settings{}, errors.New("the CA bundle must be an absolute path")
		}
		if _, err := certificatePool(s.CABundlePath); err != nil {
			return Settings{}, err
		}
	}
	return s, nil
}

// ProxyFunc sceglie il proxy di una richiesta: quello di adOmnia se configurato, altrimenti
// quello dell'ambiente di sistema.
func ProxyFunc() func(*http.Request) (*url.URL, error) {
	settings := Current()
	if settings.ProxyURL == "" {
		return http.ProxyFromEnvironment
	}
	config := httpproxy.Config{HTTPProxy: settings.ProxyURL, HTTPSProxy: settings.ProxyURL, NoProxy: settings.NoProxy}
	resolve := config.ProxyFunc()
	return func(request *http.Request) (*url.URL, error) { return resolve(request.URL) }
}

// Apply imposta proxy e CA aziendali su un transport. Non disattiva mai la verifica TLS: la CA
// interna si aggiunge al trust store di sistema.
func Apply(transport *http.Transport) error {
	transport.Proxy = ProxyFunc()
	bundle := Current().CABundlePath
	if bundle == "" {
		return nil
	}
	pool, err := certificatePool(bundle)
	if err != nil {
		return err
	}
	if transport.TLSClientConfig == nil {
		transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	transport.TLSClientConfig.RootCAs = pool
	return nil
}

// Client restituisce un client HTTP per una connessione che adOmnia avvia da sola: rispetta
// proxy e CA, è bloccato dal modo offline verso host non locali e annota ogni richiesta nel
// registro delle attività con la categoria indicata (ai, update, git-host…).
func Client(category string, timeout time.Duration) *http.Client {
	return ClientWithFallbackProxy(category, timeout, nil)
}

// ClientWithFallbackProxy è Client, ma senza un proxy di adOmnia usa fallback (es. il proxy
// dichiarato nelle impostazioni di Claude Code) invece di quello di sistema.
func ClientWithFallbackProxy(category string, timeout time.Duration, fallback func(*http.Request) (*url.URL, error)) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	applyErr := Apply(transport)
	if fallback != nil && Current().ProxyURL == "" {
		transport.Proxy = fallback
	}
	return &http.Client{Timeout: timeout, Transport: &recordingTransport{category: category, base: transport, applyErr: applyErr}}
}

// Wrap aggiunge blocco offline e registro a un transport già configurato (che deve aver chiamato Apply).
func Wrap(category string, base http.RoundTripper) http.RoundTripper {
	return &recordingTransport{category: category, base: base}
}

// Allow verifica se adOmnia può aprire da sola una connessione verso host (anche per processi
// esterni come govulncheck); un blocco viene annotato nel registro.
func Allow(category, host string) error {
	if !Current().Offline || IsLocalHost(host) {
		return nil
	}
	Record(Event{Category: category, Host: host, Outcome: OutcomeBlocked, Detail: "offline mode"})
	return ErrOffline
}

// IsLocalHost vale per loopback, nomi .localhost e host senza nome (socket locali).
func IsLocalHost(host string) bool {
	host = strings.TrimSpace(host)
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	host = strings.Trim(host, "[]")
	if host == "" || strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type recordingTransport struct {
	category string
	base     http.RoundTripper
	applyErr error
}

func (t *recordingTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	host := request.URL.Host
	if err := Allow(t.category, host); err != nil {
		return nil, err
	}
	event := Event{Category: t.category, Method: request.Method, Host: host, Path: request.URL.Path}
	if t.applyErr != nil {
		event.Outcome, event.Detail = OutcomeError, t.applyErr.Error()
		Record(event)
		return nil, t.applyErr
	}
	started := time.Now()
	response, err := t.base.RoundTrip(request)
	event.DurationMs = time.Since(started).Milliseconds()
	if err != nil {
		event.Outcome, event.Detail = OutcomeError, err.Error()
	} else {
		event.Outcome, event.Status = OutcomeOK, response.StatusCode
	}
	Record(event)
	return response, err
}

// ProcessEnvironment restituisce le variabili da dare ai processi esterni (go, git, gopls) per
// rispettare la politica di rete; i valori già presenti in env vincono, tranne in modo offline.
func ProcessEnvironment(env map[string]string) {
	settings := Current()
	setDefault := func(name, value string) {
		if _, ok := env[name]; !ok && value != "" {
			env[name] = value
		}
	}
	if settings.ProxyURL != "" {
		setDefault("HTTPS_PROXY", settings.ProxyURL)
		setDefault("HTTP_PROXY", settings.ProxyURL)
		setDefault("NO_PROXY", settings.NoProxy)
	}
	if settings.CABundlePath != "" {
		setDefault("GIT_SSL_CAINFO", settings.CABundlePath)
		setDefault("SSL_CERT_FILE", settings.CABundlePath)
	}
	if settings.Offline {
		env["GOPROXY"] = "off"
		env["GOSUMDB"] = "off"
		env["GOTOOLCHAIN"] = "local"
	}
}

func certificatePool(bundlePath string) (*x509.CertPool, error) {
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	pem, err := os.ReadFile(bundlePath)
	if err != nil {
		return nil, fmt.Errorf("cannot read CA bundle: %w", err)
	}
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("CA bundle %s contains no PEM certificates", bundlePath)
	}
	return pool, nil
}

// Environ è os.Environ() con proxy, CA e modo offline della politica di rete applicati.
func Environ() []string {
	env := map[string]string{}
	order := []string{}
	for _, entry := range os.Environ() {
		name, value, ok := strings.Cut(entry, "=")
		if !ok || name == "" {
			continue
		}
		if _, seen := env[name]; !seen {
			order = append(order, name)
		}
		env[name] = value
	}
	ProcessEnvironment(env)
	result := make([]string, 0, len(env))
	for _, name := range order {
		result = append(result, name+"="+env[name])
		delete(env, name)
	}
	for name, value := range env {
		result = append(result, name+"="+value)
	}
	return result
}
