// Package preview è il Live Server dell'IDE: ospita siti statici con live reload e fa da supervisore
// ai dev server dei framework (Vite, Next, …), tutto su 127.0.0.1 e legato alla sessione del
// progetto. È language-agnostic: sa di URL, porte e processi, non di package.json (che è dell'adapter web).
package preview

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// LoopbackHost è l'unico indirizzo su cui adOmnia mette in ascolto un server di anteprima.
const LoopbackHost = "127.0.0.1"

const portSearchSpan = 50

// FreePort restituisce la prima porta libera a partire da preferred (fino a portSearchSpan porte
// dopo); se preferred è 0 o nessuna è libera chiede al sistema una porta effimera.
func FreePort(preferred int) (int, error) {
	if preferred > 0 && preferred < 65535 {
		for port := preferred; port < preferred+portSearchSpan && port < 65535; port++ {
			if PortAvailable(port) {
				return port, nil
			}
		}
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(LoopbackHost, "0"))
	if err != nil {
		return 0, fmt.Errorf("no free local port: %w", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

// PortAvailable dice se la porta è libera sia su IPv4 sia su IPv6 loopback: un dev server può
// ascoltare su uno solo dei due e il browser risolve "localhost" in entrambi.
func PortAvailable(port int) bool {
	for _, host := range []string{LoopbackHost, "::1"} {
		listener, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
		if err != nil {
			if host == "::1" && isUnsupportedFamily(err) {
				continue
			}
			return false
		}
		_ = listener.Close()
	}
	return true
}

func isUnsupportedFamily(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "cannot assign requested address") || strings.Contains(message, "address family not supported") ||
		strings.Contains(message, "protocol not supported") || strings.Contains(message, "no such device")
}

const (
	readyPollInterval = 150 * time.Millisecond
	readyDialTimeout  = 800 * time.Millisecond
)

// WaitReady attende che l'URL risponda a una richiesta HTTP (qualunque stato: il server ascolta).
// Si ferma con ctx, quindi con la fine del processo o lo scadere del timeout del chiamante.
func WaitReady(ctx context.Context, rawURL string) error {
	client := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	var lastErr error
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
		if err != nil {
			return err
		}
		response, err := client.Do(request)
		if err == nil {
			_ = response.Body.Close()
			return nil
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return fmt.Errorf("the server did not answer: %w", lastErr)
		case <-time.After(readyPollInterval):
		}
	}
}

var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

// StripANSI toglie i codici di colore e di cursore dall'output dei dev server.
func StripANSI(text string) string { return ansiEscape.ReplaceAllString(text, "") }

var localURL = regexp.MustCompile(`https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\]):\d{2,5}[^\s"'<>)\]]*`)

// URLScanner estrae dall'output di un dev server l'URL locale su cui è in ascolto. Gli stream
// arrivano a pezzi: tiene la riga incompleta di ciascuno. Tra più URL preferisce la riga "Local:".
type URLScanner struct {
	partial map[string]string
	found   string
	local   bool
}

func NewURLScanner() *URLScanner { return &URLScanner{partial: map[string]string{}} }

// Feed consuma un blocco di output; restituisce l'URL la prima volta che lo trova (o lo trova migliore).
func (s *URLScanner) Feed(stream string, data []byte) (string, bool) {
	text := s.partial[stream] + string(data)
	lines := strings.Split(text, "\n")
	s.partial[stream] = lines[len(lines)-1]
	if len(s.partial[stream]) > 4096 {
		s.partial[stream] = ""
	}
	changed := false
	for _, line := range lines[:len(lines)-1] {
		changed = s.scanLine(line) || changed
	}
	// Una riga senza a-capo finale può già contenere l'URL: i dev server lo stampano e restano in attesa.
	changed = s.scanLine(s.partial[stream]) || changed
	return s.found, changed
}

func (s *URLScanner) scanLine(line string) bool {
	line = StripANSI(line)
	match := localURL.FindString(line)
	if match == "" {
		return false
	}
	isLocal := strings.Contains(strings.ToLower(line), "local")
	if s.found != "" && (s.local || !isLocal) {
		return false
	}
	normalized := normalizeLocalURL(match)
	if normalized == s.found {
		return false
	}
	s.found, s.local = normalized, isLocal
	return true
}

// normalizeLocalURL sostituisce gli indirizzi "tutte le interfacce" con il loopback IPv4 raggiungibile.
func normalizeLocalURL(raw string) string {
	for _, wildcard := range []string{"0.0.0.0", "[::]", "[::1]"} {
		raw = strings.Replace(raw, "//"+wildcard+":", "//"+LoopbackHost+":", 1)
	}
	return raw
}
