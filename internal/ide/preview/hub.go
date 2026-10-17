package preview

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed live.js
var liveClientScript []byte

const (
	livePrefix       = "/__adomnia/"
	liveScriptPath   = livePrefix + "live.js"
	liveEventsPath   = livePrefix + "events"
	keepAliveEvery   = 20 * time.Second
	subscriberBuffer = 8
	maxInjectedBytes = 16 << 20
)

// LiveEvent è un messaggio per le pagine collegate: "reload" ricarica, "css" aggiorna i fogli di
// stile senza ricaricare (lo stato della pagina resta).
type LiveEvent struct {
	Type  string   `json:"type"`
	Paths []string `json:"paths,omitempty"`
}

// hub è il lato server del bridge nelle pagine di anteprima: serve il client e il flusso di eventi
// (SSE) e li inoltra alle pagine collegate. È condiviso dal server statico e dal proxy dei dev server.
type hub struct {
	port int

	mu          sync.Mutex
	subscribers map[chan LiveEvent]struct{}
	closed      bool
}

func newHub(port int) *hub { return &hub{port: port, subscribers: map[chan LiveEvent]struct{}{}} }

// Broadcast inoltra un evento a tutte le pagine collegate; chi non legge abbastanza in fretta lo perde.
func (h *hub) Broadcast(event LiveEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for subscriber := range h.subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
}

// Subscribers è il numero di pagine collegate al bridge.
func (h *hub) Subscribers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subscribers)
}

// closeStreams chiude i flussi aperti e rifiuta i nuovi.
func (h *hub) closeStreams() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.closed = true
	for subscriber := range h.subscribers {
		close(subscriber)
	}
	h.subscribers = map[chan LiveEvent]struct{}{}
}

func (h *hub) subscribe() (chan LiveEvent, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, false
	}
	channel := make(chan LiveEvent, subscriberBuffer)
	h.subscribers[channel] = struct{}{}
	return channel, true
}

func (h *hub) unsubscribe(channel chan LiveEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.subscribers[channel]; ok {
		delete(h.subscribers, channel)
		close(channel)
	}
}

// allowedHost accetta solo l'indirizzo con cui il server è raggiungibile: respinge gli attacchi di
// DNS rebinding, in cui una pagina esterna risolve il proprio dominio su 127.0.0.1.
func (h *hub) allowedHost(host string) bool {
	name, port, err := net.SplitHostPort(host)
	if err != nil || port != strconv.Itoa(h.port) {
		return false
	}
	return name == LoopbackHost || strings.EqualFold(name, "localhost") || name == "::1" || name == "[::1]"
}

// serveLive risponde alle richieste del bridge (client ed eventi); false se il percorso non è suo.
func (h *hub) serveLive(w http.ResponseWriter, r *http.Request) bool {
	switch r.URL.Path {
	case liveScriptPath:
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(liveClientScript)
		return true
	case liveEventsPath:
		h.serveEvents(w, r)
		return true
	}
	return false
}

func (h *hub) serveEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	events, ok := h.subscribe()
	if !ok {
		http.Error(w, "server closed", http.StatusServiceUnavailable)
		return
	}
	defer h.unsubscribe(events)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	_, _ = io.WriteString(w, "retry: 800\n: connected\n\n")
	flusher.Flush()
	ticker := time.NewTicker(keepAliveEvery)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event, open := <-events:
			if !open {
				return
			}
			payload, _ := json.Marshal(event)
			if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
				return
			}
			flusher.Flush()
		case <-ticker.C:
			if _, err := io.WriteString(w, ": keep-alive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

var liveTag = []byte(`<script src="` + liveScriptPath + `" data-adomnia-live></script>`)

var headOpen = regexp.MustCompile(`(?i)<head(?:\s[^>]*)?>`)

// injectLiveClient aggiunge il client del bridge a una pagina HTML, in memoria. In testa al <head>,
// così vede console ed errori fin dal primo script della pagina; senza <head> prima di </body>,
// altrimenti in coda al documento.
func injectLiveClient(content []byte) []byte {
	at := len(content)
	if match := headOpen.FindIndex(content); match != nil {
		at = match[1]
	} else {
		lower := bytes.ToLower(content)
		if end := bytes.LastIndex(lower, []byte("</body>")); end >= 0 {
			at = end
		} else if end := bytes.LastIndex(lower, []byte("</html>")); end >= 0 {
			at = end
		}
	}
	out := make([]byte, 0, len(content)+len(liveTag)+1)
	out = append(out, content[:at]...)
	out = append(out, liveTag...)
	out = append(out, '\n')
	return append(out, content[at:]...)
}
