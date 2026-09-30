package devsession

import (
	"context"
	"fmt"
	"net"
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
		kind, resourceID := session.Kind, session.ResourceID
		m.mu.Unlock()
		if kind == "run" && m.hooks.RunPort != nil {
			if port := m.hooks.RunPort(resourceID); port > 0 {
				m.setDetectedPort(id, port, "env")
				return
			}
		}
		if baseline != nil {
			if port := m.newListeningPort(baseline); port > 0 {
				m.setDetectedPort(id, port, "listening")
				return
			}
		}
		time.Sleep(m.detect.interval)
	}
}

func (m *Manager) newListeningPort(baseline map[int]bool) int {
	ports, err := m.hooks.ListPorts()
	if err != nil {
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
	outputURLPort    = regexp.MustCompile(`(?i)\bhttps?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\])?:(\d{2,5})\b`)
	outputListenPort = regexp.MustCompile(`(?i)\b(?:listen(?:ing)?|serv(?:ing|er)|started|running|bound|port)\b[^\r\n]{0,40}?(?:\s|:|=|\()(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\])?:)?(\d{2,5})\b`)
)

// portFromOutput extracts the port a Go server usually prints on start:
// "listening on :8080", "http://localhost:8080", "Listening and serving HTTP on :8080".
func portFromOutput(line string) int {
	for _, pattern := range []*regexp.Regexp{outputURLPort, outputListenPort} {
		if match := pattern.FindStringSubmatch(line); match != nil {
			if port, err := strconv.Atoi(match[1]); err == nil && port >= 80 && port <= 65535 {
				return port
			}
		}
	}
	return 0
}

// WaitReady blocks until the session's port accepts TCP connections.
func (m *Manager) WaitReady(ctx context.Context, id string) error {
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
		if port > 0 {
			dialer := net.Dialer{Timeout: 500 * time.Millisecond}
			conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
			if err == nil {
				_ = conn.Close()
				return nil
			}
		}
		select {
		case <-ctx.Done():
			if port == 0 {
				return fmt.Errorf("the service did not open a port: set it by hand from the debug bar")
			}
			return fmt.Errorf("nothing is listening on port %d yet", port)
		case <-time.After(300 * time.Millisecond):
		}
	}
}
