package eclipsepde

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The runtime adapter: adOmnia starts the project in Equinox with the console on a local TCP
// port and asks the framework what is really happening. Everything here is a thin, tested
// client + parser; no instrumentation and no modern Java. Works on the Java 6/Kepler stack
// the workspace already targets.

// Console prompts of the shells Equinox ships: the classic console and Gogo.
var consolePrompts = []string{"osgi> ", "g! ", "-> "}

// Console is a connection to the Equinox console of a running framework.
type Console struct {
	conn   net.Conn
	reader *bufio.Reader
}

// DialConsole connects to the console and consumes its banner up to the first prompt.
func DialConsole(ctx context.Context, address string) (*Console, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}
	console := &Console{conn: conn, reader: bufio.NewReader(conn)}
	if _, err := console.readUntilPrompt(ctx); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("the Equinox console did not answer: %w", err)
	}
	return console, nil
}

// Ask runs one console command and returns its output without the echoed command and prompt.
func (c *Console) Ask(ctx context.Context, command string) (string, error) {
	if _, err := c.conn.Write([]byte(command + "\n")); err != nil {
		return "", err
	}
	output, err := c.readUntilPrompt(ctx)
	if err != nil {
		return output, err
	}
	// The console echoes the command: drop that first line.
	if _, rest, found := strings.Cut(output, "\n"); found && strings.Contains(output, command) {
		output = rest
	}
	return output, nil
}

// Close closes the console connection.
func (c *Console) Close() error { return c.conn.Close() }

// readUntilPrompt reads until the last non-empty line ends with a shell prompt.
func (c *Console) readUntilPrompt(ctx context.Context) (string, error) {
	if deadline, ok := ctx.Deadline(); ok {
		_ = c.conn.SetReadDeadline(deadline)
	} else {
		_ = c.conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	}
	var raw []byte
	buffer := make([]byte, 4096)
	for {
		count, err := c.reader.Read(buffer)
		if count > 0 {
			raw = append(raw, buffer[:count]...)
			clean := cleanConsoleOutput(raw)
			if line, ok := trailingPromptLine(clean); ok {
				return line, nil
			}
		}
		if err != nil {
			return cleanConsoleOutput(raw), err
		}
	}
}

// trailingPromptLine returns the output when its last non-empty line ends with a prompt.
func trailingPromptLine(output string) (string, bool) {
	trimmed := strings.TrimRight(output, " \t\r\n")
	if trimmed == "" {
		return "", false
	}
	for _, prompt := range consolePrompts {
		marker := strings.TrimRight(prompt, " ")
		if strings.HasSuffix(trimmed, marker) {
			return strings.TrimRight(trimmed[:len(trimmed)-len(marker)], " \t\r\n"), true
		}
	}
	return "", false
}

var (
	telnetIAC = byte(255)
	ansiSEQ   = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`)
)

// cleanConsoleOutput removes telnet negotiation and ANSI escapes from the byte stream. The
// telnet server of the console negotiates options before showing the prompt.
func cleanConsoleOutput(raw []byte) string {
	cleaned := make([]byte, 0, len(raw))
	for index := 0; index < len(raw); index++ {
		value := raw[index]
		if value != telnetIAC {
			cleaned = append(cleaned, value)
			continue
		}
		if index+1 >= len(raw) {
			break
		}
		command := raw[index+1]
		switch {
		case command == telnetIAC:
			cleaned = append(cleaned, telnetIAC)
			index++
		case command == 250: // subnegotiation: skip to IAC SE
			index += 2
			for index+1 < len(raw) {
				if raw[index] == telnetIAC && raw[index+1] == 240 {
					index++
					break
				}
				index++
			}
		case command >= 251 && command <= 254: // WILL/WONT/DO/DONT + option
			index += 2
		default:
			index++
		}
	}
	return ansiSEQ.ReplaceAllString(string(cleaned), "")
}

// RuntimeBundle is one bundle as the running framework reports it.
type RuntimeBundle struct {
	ID           int    `json:"id"`
	State        string `json:"state"`
	SymbolicName string `json:"symbolicName"`
	Version      string `json:"version"`
	// ActiveAtMs is when the profiler first saw the bundle ACTIVE, relative to the launch.
	ActiveAtMs int64 `json:"activeAtMs,omitempty"`
	Fragment   bool  `json:"fragment,omitempty"`
}

// RuntimeService is one service in the framework registry.
type RuntimeService struct {
	Interface  string            `json:"interface"`
	ServiceID  string            `json:"serviceId"`
	Provider   string            `json:"provider,omitempty"`
	BundleID   string            `json:"bundleId,omitempty"`
	Properties map[string]string `json:"properties,omitempty"`
	Consumers  []string          `json:"consumers,omitempty"`
}

// RuntimeSnapshot is the real state of the framework, captured without guessing.
type RuntimeSnapshot struct {
	Address string `json:"address"`
	Port    int    `json:"port"`
	// StartupMs is how long the framework took to publish a usable state.
	StartupMs           int64            `json:"startupMs"`
	FrameworkStartLevel int              `json:"frameworkStartLevel"`
	Settled             bool             `json:"settled"`
	Bundles             []RuntimeBundle  `json:"bundles"`
	Services            []RuntimeService `json:"services"`
	// Diagnoses are the Equinox `diag` lines of the bundles that did not resolve.
	Diagnoses map[int][]string `json:"diagnoses,omitempty"`
	// Problems are the console commands that failed, not a reason to fail the snapshot.
	Problems   []string  `json:"problems,omitempty"`
	CapturedAt time.Time `json:"capturedAt"`
}

// ParseBundleStates reads the output of the console `ss` command. Both the classic
// "id State Bundle" layout and the bracket layout of older consoles are accepted.
func ParseBundleStates(output string) []RuntimeBundle {
	var bundles []RuntimeBundle
	for _, line := range strings.Split(output, "\n") {
		bundle, ok := parseBundleStateLine(line)
		if ok {
			bundles = append(bundles, bundle)
		}
	}
	return bundles
}

var runtimeStateNames = map[string]bool{
	"INSTALLED": true, "RESOLVED": true, "STARTING": true, "ACTIVE": true,
	"STOPPING": true, "UNINSTALLED": true,
}

func parseBundleStateLine(line string) (RuntimeBundle, bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return RuntimeBundle{}, false
	}
	id, rest, ok := leadingBundleID(trimmed)
	if !ok {
		return RuntimeBundle{}, false
	}
	state, remainder, ok := leadingState(rest)
	if !ok {
		return RuntimeBundle{}, false
	}
	remainder = strings.TrimSpace(remainder)
	if remainder == "" {
		return RuntimeBundle{}, false
	}
	// The state column may be followed by a start level or other bracket columns.
	for strings.HasPrefix(remainder, "[") {
		_, after, found := strings.Cut(remainder, "]")
		if !found {
			break
		}
		remainder = strings.TrimSpace(after)
	}
	fragment := false
	if strings.HasSuffix(remainder, "Fragment") {
		fragment = true
		remainder = strings.TrimSpace(strings.TrimSuffix(remainder, "Fragment"))
	}
	name, version := splitNameVersion(remainder)
	if name == "" {
		return RuntimeBundle{}, false
	}
	return RuntimeBundle{ID: id, State: state, SymbolicName: name, Version: version, Fragment: fragment}, true
}

// leadingBundleID reads the id, with or without the bracket layout.
func leadingBundleID(line string) (int, string, bool) {
	if strings.HasPrefix(line, "[") {
		inner, rest, found := strings.Cut(line, "]")
		if !found {
			return 0, "", false
		}
		id, err := strconv.Atoi(strings.TrimSpace(strings.Trim(inner, "[]")))
		if err != nil {
			return 0, "", false
		}
		return id, strings.TrimSpace(rest), true
	}
	fields := strings.Fields(line)
	if len(fields) < 3 {
		return 0, "", false
	}
	id, err := strconv.Atoi(fields[0])
	if err != nil {
		return 0, "", false
	}
	return id, strings.Join(fields[1:], " "), true
}

// leadingState reads the state column, unbracketed or bracketed.
func leadingState(rest string) (string, string, bool) {
	if strings.HasPrefix(rest, "[") {
		inner, after, found := strings.Cut(rest, "]")
		if !found {
			return "", rest, false
		}
		state := strings.ToUpper(strings.TrimSpace(strings.Trim(inner, "[]")))
		if !runtimeStateNames[state] {
			return "", rest, false
		}
		return state, strings.TrimSpace(after), true
	}
	fields := strings.Fields(rest)
	if len(fields) == 0 {
		return "", rest, false
	}
	state := strings.ToUpper(fields[0])
	if !runtimeStateNames[state] {
		return "", rest, false
	}
	return state, strings.Join(fields[1:], " "), true
}

// splitNameVersion splits "com.acme.core_1.2.0" at the last underscore.
func splitNameVersion(value string) (string, string) {
	value = strings.TrimSpace(value)
	if index := strings.LastIndexByte(value, '_'); index > 0 {
		return value[:index], value[index+1:]
	}
	return value, ""
}

// ParseServices reads the output of the console `services` command: one service per
// "{interface}={properties}" block, plus the "Used by" consumers the console lists.
func ParseServices(output string) []RuntimeService {
	var services []RuntimeService
	var current *RuntimeService
	usedBy := false
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			usedBy = false
			continue
		}
		if strings.HasPrefix(trimmed, "{") {
			iface, rest, ok := strings.Cut(strings.TrimPrefix(trimmed, "{"), "}")
			if !ok || iface == "" {
				continue
			}
			service := RuntimeService{Interface: iface, Properties: map[string]string{}}
			rest = strings.TrimPrefix(rest, "=")
			rest = strings.TrimPrefix(rest, "{")
			rest = strings.TrimSuffix(rest, "}")
			for _, entry := range strings.Split(rest, ",") {
				key, value, found := strings.Cut(entry, "=")
				if !found {
					continue
				}
				key, value = strings.TrimSpace(key), strings.TrimSpace(value)
				service.Properties[key] = value
				if key == "service.id" {
					service.ServiceID = value
				}
				if key == "service.bundleid" {
					service.BundleID = value
				}
			}
			services = append(services, service)
			current = &services[len(services)-1]
			usedBy = strings.Contains(trimmed, "Used by")
			continue
		}
		if strings.HasPrefix(trimmed, "Used by") {
			usedBy = current != nil
			continue
		}
		if usedBy && current != nil {
			consumer := strings.TrimSpace(strings.TrimSuffix(trimmed, ","))
			if consumer != "" && !strings.HasPrefix(consumer, "{") {
				current.Consumers = append(current.Consumers, consumer)
			}
		}
	}
	sort.SliceStable(services, func(i, j int) bool {
		if services[i].Interface != services[j].Interface {
			return services[i].Interface < services[j].Interface
		}
		return services[i].ServiceID < services[j].ServiceID
	})
	return services
}

var startLevelPattern = regexp.MustCompile(`(?i)start\s*level[^0-9]*([0-9]+)`)

// ParseStartLevel reads the framework start level from the `startlevel` command output.
func ParseStartLevel(output string) int {
	if match := startLevelPattern.FindStringSubmatch(output); len(match) == 2 {
		if value, err := strconv.Atoi(match[1]); err == nil {
			return value
		}
	}
	return 0
}

// ParseDiagnosis is the `diag <id>` output: the Equinox reason a bundle is not resolved.
func ParseDiagnosis(output string) []string {
	var lines []string
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "osgi>") {
			continue
		}
		lines = append(lines, trimmed)
	}
	return lines
}

// CorrelateRuntime writes the real states onto the explorer rows and returns the runtime
// diagnostics. It is the only place where ACTIVE comes from: static analysis never invents it.
func (r *ExplorerReport) CorrelateRuntime(snapshot *RuntimeSnapshot) []Diagnostic {
	if snapshot == nil {
		return nil
	}
	byName := map[string]RuntimeBundle{}
	byID := map[int]RuntimeBundle{}
	for _, bundle := range snapshot.Bundles {
		byName[bundle.SymbolicName] = bundle
		byID[bundle.ID] = bundle
	}
	for index := range r.Bundles {
		row := &r.Bundles[index]
		runtime, ok := byName[row.SymbolicName]
		if !ok {
			continue
		}
		row.RuntimeState = runtime.State
		row.ActiveAtMs = runtime.ActiveAtMs
		switch runtime.State {
		case "ACTIVE":
			row.State = "ACTIVE"
		case "RESOLVED", "STARTING":
			if row.State != "ACTIVE" {
				row.State = "RESOLVED"
			}
		case "INSTALLED":
			row.State = "INSTALLED"
		}
	}
	for index := range snapshot.Services {
		service := &snapshot.Services[index]
		if service.BundleID == "" {
			continue
		}
		id, err := strconv.Atoi(service.BundleID)
		if err != nil {
			continue
		}
		if provider, ok := byID[id]; ok {
			service.Provider = provider.SymbolicName
		}
	}
	r.Runtime = snapshot
	r.Summary.Active = 0
	r.Summary.Services = len(snapshot.Services)
	for _, row := range r.Bundles {
		if row.Source == string(SourceWorkspace) && row.RuntimeState == "ACTIVE" {
			r.Summary.Active++
		}
	}
	diagnostics := r.runtimeDiagnostics(snapshot, byName)
	r.RuntimeDiagnostics = diagnostics
	r.Summary.RuntimeIssues = 0
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity != "info" {
			r.Summary.RuntimeIssues++
		}
	}
	return diagnostics
}

// runtimeDiagnostics explains the states only the running framework knows.
func (r *ExplorerReport) runtimeDiagnostics(snapshot *RuntimeSnapshot, byName map[string]RuntimeBundle) []Diagnostic {
	var out []Diagnostic
	for _, row := range r.Bundles {
		if row.Source != string(SourceWorkspace) {
			continue
		}
		runtime, ok := byName[row.SymbolicName]
		if !ok {
			continue
		}
		base := "runtime|" + row.SymbolicName
		switch runtime.State {
		case "INSTALLED":
			evidence := append([]string{"Equinox state: INSTALLED"}, snapshot.Diagnoses[runtime.ID]...)
			out = append(out, Diagnostic{
				ID: base + "|unresolved", Bundle: row.SymbolicName, Version: row.Version,
				Severity: "error", Kind: "runtime-unresolved",
				Title:    "Equinox did not resolve it at runtime",
				Cause:    "The static analysis may not see the whole platform: the running framework stopped before resolving this bundle, and its own diagnosis is the reason to fix.",
				Evidence: evidence,
				Actions:  []string{"fix the requirement named by Equinox", "reindex the target platform and start the runtime again"},
			})
		case "RESOLVED":
			if row.Lazy {
				continue // ready, not active: lazy is normal
			}
			out = append(out, Diagnostic{
				ID: base + "|inactive", Bundle: row.SymbolicName, Version: row.Version,
				Severity: "warning", Kind: "runtime-inactive",
				Title:    "Resolved but never activated",
				Cause:    fmt.Sprintf("Equinox resolved the bundle and its activation policy is eager, but it never became ACTIVE (start level %d).", snapshot.FrameworkStartLevel),
				Evidence: []string{"Equinox state: RESOLVED", "activation policy: eager"},
				Actions:  []string{"raise the framework start level", "add @start to its osgi.bundles entry"},
			})
		}
	}
	return out
}
