// Package logstream tails a local file or streams container logs into a
// bounded in-memory buffer the Log Inspector polls.
//
// Two guarantees shape the design:
//
//   - Stopping a source stops the work. A stopped session kills its process
//     and its tail goroutine; closing it frees the buffer.
//   - Resuming does not duplicate. A file resumes from the byte offset it had
//     reached, so nothing is re-read. A container has no offset, so it is
//     restarted from the timestamp of the last line received and lines already
//     held in the buffer are dropped for a short reconnection window.
package logstream

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// Live tailing is a window on a running system, not an archive: the buffer
	// is bounded and the oldest lines are dropped, never the newest.
	defaultBufferLines = 5000
	maxBufferLines     = 200_000
	// Lines compared against the buffer right after a reconnect.
	reconnectWindow = 15 * time.Second
	pollInterval    = 700 * time.Millisecond
	maxLineBytes    = 1 << 20
)

type Kind string

const (
	KindFile    Kind = "file"
	KindKubectl Kind = "kubectl"
	KindOc      Kind = "oc"
	KindDocker  Kind = "docker"
)

// Config describes one live source. Container selection is explicit: nothing
// is inferred from a current kube context that the user did not choose here.
type Config struct {
	Kind        Kind   `json:"kind"`
	Path        string `json:"path"`
	Context     string `json:"context"`
	Namespace   string `json:"namespace"`
	Pod         string `json:"pod"`
	Container   string `json:"container"`
	Since       int    `json:"sinceSeconds"`
	BufferLines int    `json:"bufferLines"`
	// FromStart reads a file from byte 0 instead of from its current end.
	FromStart bool `json:"fromStart"`
}

func (c Config) label() string {
	switch c.Kind {
	case KindFile:
		return filepath.Base(c.Path)
	case KindDocker:
		return "docker:" + c.Container
	default:
		return fmt.Sprintf("%s:%s/%s", c.Kind, c.Namespace, c.Pod)
	}
}

type Session struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Config Config `json:"config"`

	mu       sync.Mutex
	lines    []string
	base     int64 // sequence number of lines[0]
	next     int64 // sequence number of the next line appended
	dropped  int64
	running  bool
	lastErr  string
	offset   int64 // file byte offset reached, used to resume without repeats
	lastSeen time.Time
	cancel   context.CancelFunc
	reopenAt time.Time // reconnect window during which repeats are suppressed
}

var (
	registry   = map[string]*Session{}
	registryMu sync.Mutex
	sequence   int64
)

// ─── Buffer ──────────────────────────────────────────────────────────────────

func (s *Session) capacity() int {
	if s.Config.BufferLines <= 0 {
		return defaultBufferLines
	}
	if s.Config.BufferLines > maxBufferLines {
		return maxBufferLines
	}
	return s.Config.BufferLines
}

func (s *Session) append(line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Now().Before(s.reopenAt) && s.holdsLine(line) {
		return // a repeat of what we already have, produced by the reconnect
	}
	s.lines = append(s.lines, line)
	s.next++
	if over := len(s.lines) - s.capacity(); over > 0 {
		s.lines = append([]string(nil), s.lines[over:]...)
		s.base += int64(over)
		s.dropped += int64(over)
	}
	s.lastSeen = time.Now()
}

// holdsLine reports whether the tail of the buffer already contains line.
// Caller holds the lock.
func (s *Session) holdsLine(line string) bool {
	start := len(s.lines) - 400
	if start < 0 {
		start = 0
	}
	for _, held := range s.lines[start:] {
		if held == line {
			return true
		}
	}
	return false
}

func (s *Session) fail(err error) {
	s.mu.Lock()
	s.lastErr = err.Error()
	s.running = false
	s.mu.Unlock()
}

type PollResult struct {
	Lines []string `json:"lines"`
	// Sequence to send on the next poll.
	Cursor  int64  `json:"cursor"`
	Running bool   `json:"running"`
	Error   string `json:"error"`
	// Lines evicted from the buffer before the client read them.
	Dropped int64 `json:"dropped"`
	// True when the requested cursor was already evicted.
	Missed bool `json:"missed"`
}

// Poll returns the lines appended after cursor. A cursor of -1 means "start
// from whatever the buffer holds now".
func (s *Session) Poll(cursor int64) PollResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := PollResult{Cursor: s.next, Running: s.running, Error: s.lastErr, Dropped: s.dropped}
	if cursor < 0 || cursor > s.next {
		cursor = s.base
	}
	if cursor < s.base {
		result.Missed = true
		cursor = s.base
	}
	if from := int(cursor - s.base); from < len(s.lines) {
		result.Lines = append([]string(nil), s.lines[from:]...)
	}
	return result
}

// ─── Tailing ─────────────────────────────────────────────────────────────────

func (s *Session) tailFile(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		file, err := os.Open(s.Config.Path)
		if err != nil {
			s.fail(fmt.Errorf("cannot open %s: %w", s.Config.Path, err))
			return
		}
		info, err := file.Stat()
		if err != nil {
			file.Close()
			s.fail(err)
			return
		}

		s.mu.Lock()
		offset := s.offset
		s.mu.Unlock()
		if offset > info.Size() {
			// The file shrank: it was rotated or truncated under us.
			offset = 0
		} else if offset == 0 && !s.Config.FromStart {
			offset = info.Size()
		}
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			file.Close()
			s.fail(err)
			return
		}

		reader := bufio.NewReaderSize(file, 64*1024)
		rotated := false
		for !rotated {
			if ctx.Err() != nil {
				file.Close()
				return
			}
			line, err := reader.ReadString('\n')
			if len(line) > 0 {
				offset += int64(len(line))
				s.mu.Lock()
				s.offset = offset
				s.mu.Unlock()
				s.append(strings.TrimRight(line, "\r\n"))
				continue
			}
			if err != nil && !errors.Is(err, io.EOF) {
				file.Close()
				s.fail(err)
				return
			}
			// EOF: wait, then check whether the file was rotated away.
			select {
			case <-ctx.Done():
				file.Close()
				return
			case <-time.After(pollInterval):
			}
			current, statErr := os.Stat(s.Config.Path)
			if statErr != nil {
				continue // the rotation may not have recreated the file yet
			}
			if current.Size() < offset {
				rotated = true
				s.mu.Lock()
				s.offset = 0
				s.mu.Unlock()
			}
		}
		file.Close()
	}
}

func containerArgs(config Config) (string, []string, error) {
	switch config.Kind {
	case KindKubectl, KindOc:
		if config.Pod == "" {
			return "", nil, errors.New("select a pod")
		}
		args := []string{"logs", "-f", config.Pod}
		if config.Namespace != "" {
			args = append(args, "-n", config.Namespace)
		}
		if config.Container != "" {
			args = append(args, "-c", config.Container)
		}
		if config.Context != "" {
			args = append(args, "--context", config.Context)
		}
		if config.Since > 0 {
			args = append(args, fmt.Sprintf("--since=%ds", config.Since))
		}
		return string(config.Kind), args, nil
	case KindDocker:
		if config.Container == "" {
			return "", nil, errors.New("select a container")
		}
		args := []string{"logs", "-f"}
		if config.Since > 0 {
			args = append(args, fmt.Sprintf("--since=%ds", config.Since))
		}
		return "docker", append(args, config.Container), nil
	default:
		return "", nil, fmt.Errorf("unsupported source kind %q", config.Kind)
	}
}

func (s *Session) tailCommand(ctx context.Context) {
	name, args, err := containerArgs(s.Config)
	if err != nil {
		s.fail(err)
		return
	}
	if _, err := exec.LookPath(name); err != nil {
		s.fail(fmt.Errorf("%s is not installed or not on PATH", name))
		return
	}
	cmd := exec.CommandContext(ctx, name, args...)
	hideConsole(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.fail(err)
		return
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		s.fail(fmt.Errorf("could not start %s: %w", name, err))
		return
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), maxLineBytes)
	for scanner.Scan() {
		s.append(scanner.Text())
	}
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return // stopped on request, not a failure
	}
	if waitErr != nil {
		s.fail(fmt.Errorf("%s stopped: %w", name, waitErr))
		return
	}
	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

func (s *Session) start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.running = true
	s.lastErr = ""
	// Resuming a container stream replays whatever the runtime still holds;
	// repeats of lines already buffered are suppressed for this window.
	if len(s.lines) > 0 && s.Config.Kind != KindFile {
		s.reopenAt = time.Now().Add(reconnectWindow)
	}
	kind := s.Config.Kind
	s.mu.Unlock()

	go func() {
		if kind == KindFile {
			s.tailFile(ctx)
		} else {
			s.tailCommand(ctx)
		}
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()
	}()
}

func (s *Session) stop() {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.running = false
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// Start creates a session and begins tailing it.
func Start(config Config) (*Session, error) {
	if config.Kind == KindFile {
		if config.Path == "" {
			return nil, errors.New("select a file")
		}
		if _, err := os.Stat(config.Path); err != nil {
			return nil, fmt.Errorf("cannot read %s: %w", config.Path, err)
		}
	} else if _, _, err := containerArgs(config); err != nil {
		return nil, err
	}

	registryMu.Lock()
	sequence++
	session := &Session{
		ID:     fmt.Sprintf("live-%d-%d", time.Now().UnixMilli(), sequence),
		Label:  config.label(),
		Config: config,
	}
	registry[session.ID] = session
	registryMu.Unlock()

	session.start()
	return session, nil
}

func lookup(id string) *Session {
	registryMu.Lock()
	defer registryMu.Unlock()
	return registry[id]
}

// Close stops a session and forgets it, freeing its buffer.
func Close(id string) {
	registryMu.Lock()
	session := registry[id]
	delete(registry, id)
	registryMu.Unlock()
	if session != nil {
		session.stop()
	}
}

// CloseAll stops every session, on shutdown.
func CloseAll() {
	registryMu.Lock()
	sessions := make([]*Session, 0, len(registry))
	for _, session := range registry {
		sessions = append(sessions, session)
	}
	registry = map[string]*Session{}
	registryMu.Unlock()
	for _, session := range sessions {
		session.stop()
	}
}

// Tools reports which command-line dependencies are available, so the UI can
// say what is missing instead of failing at start time.
func Tools() map[string]bool {
	available := map[string]bool{}
	for _, name := range []string{"kubectl", "oc", "docker"} {
		_, err := exec.LookPath(name)
		available[name] = err == nil
	}
	return available
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/logstream/tools", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, Tools())
	})

	mux.HandleFunc("/logstream/start", func(w http.ResponseWriter, r *http.Request) {
		var config Config
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		session, err := Start(config)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": session.ID, "label": session.Label, "error": ""})
	})

	mux.HandleFunc("/logstream/poll", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		session := lookup(id)
		if session == nil {
			writeJSON(w, http.StatusOK, PollResult{Error: "this live source is no longer open"})
			return
		}
		cursor := int64(-1)
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
				cursor = parsed
			}
		}
		writeJSON(w, http.StatusOK, session.Poll(cursor))
	})

	mux.HandleFunc("/logstream/resume", func(w http.ResponseWriter, r *http.Request) {
		session := lookup(r.URL.Query().Get("id"))
		if session == nil {
			writeJSON(w, http.StatusOK, map[string]string{"error": "this live source is no longer open"})
			return
		}
		session.start()
		writeJSON(w, http.StatusOK, map[string]string{"error": ""})
	})

	mux.HandleFunc("/logstream/stop", func(w http.ResponseWriter, r *http.Request) {
		session := lookup(r.URL.Query().Get("id"))
		if session != nil {
			session.stop()
		}
		writeJSON(w, http.StatusOK, map[string]string{"error": ""})
	})

	mux.HandleFunc("/logstream/close", func(w http.ResponseWriter, r *http.Request) {
		Close(r.URL.Query().Get("id"))
		writeJSON(w, http.StatusOK, map[string]string{"error": ""})
	})
}
