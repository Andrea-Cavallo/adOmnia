package devsession

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type detectConfig struct {
	interval time.Duration
	timeout  time.Duration
}

var defaultDetect = detectConfig{interval: 800 * time.Millisecond, timeout: 2 * time.Minute}

// infraProcesses never are the service: the debugger, gopls, the go tool and linters.
var infraProcesses = map[string]bool{"dlv": true, "gopls": true, "go": true, "golangci-lint": true, "staticcheck": true}

func isInfraProcess(name string) bool {
	lower := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(name)), ".exe")
	return infraProcesses[lower] || strings.HasPrefix(lower, "adomnia")
}

// detectPort finds the port the service binds. In order: the PORT a run
// configuration injected, a port printed on the output (handled in the log
// path), then a listening socket that appeared after the start and does not
// belong to tooling. The first answer wins; a manual port is never replaced.
func (m *Manager) detectPort(id string) {
	var baseline map[int]bool
	if m.hooks.ListPorts != nil {
		if ports, err := m.hooks.ListPorts(); err == nil {
			baseline = make(map[int]bool, len(ports))
			for _, port := range ports {
				baseline[port.Port] = true
			}
		}
	}
	deadline := time.Now().Add(m.detect.timeout)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		session, ok := m.sessions[id]
		if !ok || session.EndedAt != nil || session.Port != 0 {
			m.mu.Unlock()
			return
		}
		kind, resourceID, pid := session.Kind, session.ResourceID, session.PID
		m.mu.Unlock()
		if kind == "run" && m.hooks.RunPort != nil {
			if port := m.hooks.RunPort(resourceID); port > 0 {
				m.setDetectedPort(id, port, "env")
				return
			}
		}
		if m.hooks.ListPorts != nil {
			if port := m.newListeningPort(baseline, pid); port > 0 {
				m.setDetectedPort(id, port, "listening")
				return
			}
		}
		time.Sleep(m.detect.interval)
	}
}

// newListeningPort prefers a socket of the session's own process or of Delve's
// __debug_bin; only then a socket that appeared after the start (baseline diff),
// which a fast-starting service may already have opened.
func (m *Manager) newListeningPort(baseline map[int]bool, pid int) int {
	ports, err := m.hooks.ListPorts()
	if err != nil {
		return 0
	}
	for _, port := range ports {
		owned := (pid > 0 && port.PID == pid) || strings.HasPrefix(strings.ToLower(port.Process), "__debug_bin")
		if owned && port.Port > 0 && !m.portTaken(port.Port) && (pid > 0 || !baseline[port.Port]) {
			return port.Port
		}
	}
	if baseline == nil {
		return 0
	}
	own := os.Getpid()
	best := 0
	for _, port := range ports {
		if baseline[port.Port] || port.PID == own || isInfraProcess(port.Process) || port.Port <= 0 {
			continue
		}
		if m.portTaken(port.Port) {
			continue
		}
		if best == 0 || port.Port < best {
			best = port.Port
		}
	}
	return best
}

// portTaken is true when another live session already owns the port.
func (m *Manager) portTaken(port int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, session := range m.sessions {
		if session.EndedAt == nil && session.Port == port {
			return true
		}
	}
	return false
}

// setDetectedPort records a detected port unless one is already known.
func (m *Manager) setDetectedPort(id string, port int, source string) {
	m.mu.Lock()
	session, ok := m.sessions[id]
	if !ok || session.EndedAt != nil || session.Port != 0 {
		m.mu.Unlock()
		return
	}
	session.Port, session.PortSource = port, source
	event := Event{Type: "service.updated", SessionID: id, Payload: cloneSession(session)}
	m.mu.Unlock()
	m.publish([]Event{event})
}

var (
	outputURLPort = regexp.MustCompile(`(?i)\bhttps?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\])?:(\d{2,5})\b`)
	listenWord    = regexp.MustCompile(`(?i)\b(?:listen(?:ing)?|serv(?:ing|er)|started|running|bound|ready|addr|http)\b`)
	// host:port where the host is a name, an IP, [::] or nothing (":8080"); a
	// timestamp such as 11:45:02 never matches because its "host" is digits
	// glued to the colon.
	outputHostPort = regexp.MustCompile(`(?:^|[\s"'=(\[,])(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]*\]|\*|[a-zA-Z][\w.-]*)?:(\d{2,5})\b`)
	outputPortWord = regexp.MustCompile(`(?i)\bport\b\D{0,3}(\d{2,5})\b`)
)

func validPort(text string) int {
	port, err := strconv.Atoi(text)
	if err != nil || port < 80 || port > 65535 {
		return 0
	}
	return port
}

// portFromOutput extracts the port a Go server usually prints on start:
// "listening on :8080", "listening on 127.0.0.1:8080",
// "http://localhost:8080", "Listening and serving HTTP on :8080", "port=8080".
func portFromOutput(line string) int {
	if match := outputURLPort.FindStringSubmatch(line); match != nil {
		if port := validPort(match[1]); port > 0 {
			return port
		}
	}
	if !listenWord.MatchString(line) && !outputPortWord.MatchString(line) {
		return 0
	}
	for _, match := range outputHostPort.FindAllStringSubmatch(line, -1) {
		if port := validPort(match[1]); port > 0 {
			return port
		}
	}
	if match := outputPortWord.FindStringSubmatch(line); match != nil {
		return validPort(match[1])
	}
	return 0
}

// WaitReady blocks until the session's port accepts TCP connections.
func (m *Manager) WaitReady(ctx context.Context, id string) error {
	return m.WaitReadyAt(ctx, id, "")
}

// WaitReadyAt waits for the port and, with a health path such as /healthz,
// for an HTTP answer below 500 on it.
func (m *Manager) WaitReadyAt(ctx context.Context, id, healthPath string) error {
	for {
		m.mu.Lock()
		session, err := m.sessionLocked(id)
		if err != nil {
			m.mu.Unlock()
			return err
		}
		if session.EndedAt != nil {
			m.mu.Unlock()
			return fmt.Errorf("%s stopped before it was ready", session.Service)
		}
		port := session.Port
		m.mu.Unlock()
		if port > 0 && accepts(ctx, port) && healthy(ctx, port, healthPath) {
			return nil
		}
		select {
		case <-ctx.Done():
			if port == 0 {
				return fmt.Errorf("the service did not open a port: set it by hand from the debug bar")
			}
			if healthPath != "" {
				return fmt.Errorf("%s on port %d did not answer yet", healthPath, port)
			}
			return fmt.Errorf("nothing is listening on port %d yet", port)
		case <-time.After(300 * time.Millisecond):
		}
	}
}

// accepts tries IPv4 then IPv6 loopback: a service may bind only one of them.
func accepts(ctx context.Context, port int) bool {
	dialer := net.Dialer{Timeout: 500 * time.Millisecond}
	for _, host := range []string{"127.0.0.1", "::1"} {
		if conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port))); err == nil {
			_ = conn.Close()
			return true
		}
	}
	return false
}

func healthy(ctx context.Context, port int, path string) bool {
	if path == "" {
		return true
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+strconv.Itoa(port)+path, nil)
	if err != nil {
		return false
	}
	response, err := (&http.Client{Timeout: 2 * time.Second}).Do(request)
	if err != nil {
		return false
	}
	_ = response.Body.Close()
	return response.StatusCode < 500
}
