package goide

import (
	"bufio"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	// maxGoroutineOverview limita il costo della vista Concurrency su programmi con molte goroutine.
	maxGoroutineOverview = 1000
	// goroutineStackDepth basta a trovare la causa del blocco e la funzione di avvio.
	goroutineStackDepth = 48
	maxSourceLineChars  = 200
)

// Stati di una goroutine in pausa, dedotti dallo stack: Delve via DAP non espone la wait reason.
const (
	GoroutineRunning   = "running"
	GoroutineChanRecv  = "chan receive"
	GoroutineChanSend  = "chan send"
	GoroutineSelect    = "select"
	GoroutineMutex     = "mutex"
	GoroutineWaitGroup = "waitgroup"
	GoroutineCond      = "cond"
	GoroutineSleep     = "sleep"
	GoroutineIO        = "io wait"
	GoroutineSyscall   = "syscall"
	GoroutineWaiting   = "waiting"
)

// GoroutineSummary è una goroutine vista dall'IDE: stato, causa del blocco, dove si trova e dove è partita.
type GoroutineSummary struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Current bool   `json:"current"`
	State   string `json:"state"`
	// BlockedOn è l'espressione su cui la goroutine aspetta (es. "s.orderChannel"), letta dalla riga di codice.
	BlockedOn string `json:"blockedOn,omitempty"`
	// Location è il frame di progetto più in alto: la riga che l'utente riconosce.
	Location *DebugFrame `json:"location,omitempty"`
	// SourceLine è il testo di Location, per mostrare "84 │ order := <-s.orderChannel".
	SourceLine string `json:"sourceLine,omitempty"`
	// Origin è il frame di progetto più in basso: la funzione avviata dall'istruzione go.
	Origin *DebugFrame  `json:"origin,omitempty"`
	Frames []DebugFrame `json:"frames"`
}

// GoroutineOverview è l'istantanea di tutte le goroutine alla pausa corrente.
type GoroutineOverview struct {
	Goroutines []GoroutineSummary `json:"goroutines"`
	// Truncated indica che le goroutine erano più di maxGoroutineOverview.
	Truncated bool `json:"truncated,omitempty"`
}

var goroutineIDPattern = regexp.MustCompile(`\[Go (\d+)\]`)

// Funzioni del runtime e della libreria standard che identificano il motivo di un'attesa.
var goroutineWaitMarkers = []struct {
	prefix string
	state  string
}{
	{"runtime.chanrecv", GoroutineChanRecv},
	{"runtime.chansend", GoroutineChanSend},
	{"runtime.selectgo", GoroutineSelect},
	{"runtime.block", GoroutineSelect},
	{"sync.(*Mutex).Lock", GoroutineMutex},
	{"sync.(*Mutex).lockSlow", GoroutineMutex},
	{"sync.(*RWMutex).Lock", GoroutineMutex},
	{"sync.(*RWMutex).RLock", GoroutineMutex},
	{"internal/sync.(*Mutex)", GoroutineMutex},
	{"sync.runtime_SemacquireMutex", GoroutineMutex},
	{"sync.runtime_SemacquireRWMutex", GoroutineMutex},
	{"sync.(*WaitGroup).Wait", GoroutineWaitGroup},
	{"sync.(*Cond).Wait", GoroutineCond},
	{"time.Sleep", GoroutineSleep},
	{"internal/poll.runtime_pollWait", GoroutineIO},
	{"internal/poll.(*FD)", GoroutineIO},
	{"net.(*netFD)", GoroutineIO},
	{"syscall.Syscall", GoroutineSyscall},
	{"syscall.syscall", GoroutineSyscall},
	{"runtime.gopark", GoroutineWaiting},
}

var (
	chanReceivePattern = regexp.MustCompile(`<-\s*([A-Za-z_][\w.\[\]()]*)`)
	chanSendPattern    = regexp.MustCompile(`([A-Za-z_][\w.\[\]]*)\s*<-`)
	lockPattern        = regexp.MustCompile(`([A-Za-z_][\w.\[\]()]*)\.(?:R?Lock)\(`)
	waitPattern        = regexp.MustCompile(`([A-Za-z_][\w.\[\]()]*)\.Wait\(`)
)

// Goroutines legge lo stack di ogni goroutine e ne deduce stato, causa e origine.
func (m *DebugManager) Goroutines(id DebugSessionID) (GoroutineOverview, error) {
	threads, err := m.Threads(id)
	if err != nil {
		return GoroutineOverview{}, err
	}
	overview := GoroutineOverview{Truncated: len(threads) > maxGoroutineOverview}
	if overview.Truncated {
		threads = threads[:maxGoroutineOverview]
	}
	sources := newSourceLineCache()
	for _, thread := range threads {
		frames, err := m.stackTrace(id, thread.ID, goroutineStackDepth)
		if err != nil {
			frames = nil
		}
		overview.Goroutines = append(overview.Goroutines, summarizeGoroutine(thread, frames, sources))
	}
	return overview, nil
}

func summarizeGoroutine(thread DebugThread, frames []DebugFrame, sources *sourceLineCache) GoroutineSummary {
	summary := GoroutineSummary{
		ID:      goroutineID(thread),
		Name:    thread.Name,
		Current: strings.HasPrefix(strings.TrimSpace(thread.Name), "*"),
		State:   goroutineState(frames),
		Frames:  frames,
	}
	if frames == nil {
		summary.Frames = []DebugFrame{}
	}
	summary.Location, summary.Origin = projectFrames(frames)
	if summary.Location != nil {
		summary.SourceLine = sources.line(summary.Location.Path, summary.Location.Line)
		summary.BlockedOn = blockedOn(summary.State, summary.SourceLine)
	}
	return summary
}

func goroutineID(thread DebugThread) int {
	if match := goroutineIDPattern.FindStringSubmatch(thread.Name); match != nil {
		if value, err := strconv.Atoi(match[1]); err == nil {
			return value
		}
	}
	return thread.ID
}

// goroutineState cerca, sopra il primo frame di progetto, la funzione che spiega l'attesa.
// runtime.gopark è in cima a quasi ogni attesa: vale solo se non c'è nulla di più preciso.
func goroutineState(frames []DebugFrame) string {
	parked := false
	for _, frame := range frames {
		if frame.RelativePath != "" {
			break
		}
		for _, marker := range goroutineWaitMarkers {
			if !strings.HasPrefix(frame.Name, marker.prefix) {
				continue
			}
			if marker.state != GoroutineWaiting {
				return marker.state
			}
			parked = true
		}
	}
	if parked {
		return GoroutineWaiting
	}
	return GoroutineRunning
}

// projectFrames restituisce il frame di progetto più in alto e quello più in basso.
func projectFrames(frames []DebugFrame) (*DebugFrame, *DebugFrame) {
	var top, bottom *DebugFrame
	for index := range frames {
		if frames[index].RelativePath == "" {
			continue
		}
		if top == nil {
			top = &frames[index]
		}
		bottom = &frames[index]
	}
	return top, bottom
}

// blockedOn estrae dalla riga di codice l'oggetto dell'attesa: canale, mutex o WaitGroup.
func blockedOn(state, source string) string {
	var pattern *regexp.Regexp
	switch state {
	case GoroutineChanRecv, GoroutineSelect:
		pattern = chanReceivePattern
	case GoroutineChanSend:
		pattern = chanSendPattern
	case GoroutineMutex:
		pattern = lockPattern
	case GoroutineWaitGroup, GoroutineCond:
		pattern = waitPattern
	default:
		return ""
	}
	if match := pattern.FindStringSubmatch(source); match != nil {
		return match[1]
	}
	return ""
}

// sourceLineCache legge ogni file una volta sola per istantanea.
type sourceLineCache struct {
	files map[string][]string
}

func newSourceLineCache() *sourceLineCache {
	return &sourceLineCache{files: map[string][]string{}}
}

func (c *sourceLineCache) line(path string, number int) string {
	if path == "" || number <= 0 {
		return ""
	}
	lines, ok := c.files[path]
	if !ok {
		lines = readSourceLines(path)
		c.files[path] = lines
	}
	if number > len(lines) {
		return ""
	}
	text := strings.TrimSpace(lines[number-1])
	if len(text) > maxSourceLineChars {
		text = text[:maxSourceLineChars]
	}
	return text
}

func readSourceLines(path string) []string {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()
	var lines []string
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines
}
