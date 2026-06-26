package nettools

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"adomnia/internal/httputil"
)

// PortEntry describes one listening TCP socket and the process that owns it.
type PortEntry struct {
	Protocol string `json:"protocol"`
	Address  string `json:"address"`
	Port     int    `json:"port"`
	PID      int    `json:"pid"`
	Process  string `json:"process"`
}

type listeningPortsResponse struct {
	OS      string      `json:"os"`
	Source  string      `json:"source"`
	Entries []PortEntry `json:"entries"`
}

// listeningPortsHandler returns the TCP ports currently in LISTEN state on the
// local machine, each annotated with the owning process. It picks the right
// native tool per OS (netstat on Windows, ss/netstat on Linux, lsof on macOS).
func listeningPortsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	source, entries, err := listListeningPorts(ctx)
	if err != nil {
		httputil.JSONError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Port != entries[j].Port {
			return entries[i].Port < entries[j].Port
		}
		return entries[i].PID < entries[j].PID
	})
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(listeningPortsResponse{
		OS:      runtime.GOOS,
		Source:  source,
		Entries: entries,
	})
}

func runCmd(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	configureHiddenCommand(cmd)
	out, err := cmd.Output()
	return string(out), err
}

func listListeningPorts(ctx context.Context) (string, []PortEntry, error) {
	switch runtime.GOOS {
	case "windows":
		out, err := runCmd(ctx, "netstat", "-ano", "-p", "tcp")
		if err != nil {
			return "", nil, err
		}
		names := windowsPIDNames(ctx)
		return "netstat -ano", parseNetstatWindows(out, names), nil
	case "darwin":
		out, err := runCmd(ctx, "lsof", "-nP", "-iTCP", "-sTCP:LISTEN")
		if err != nil {
			return "", nil, err
		}
		return "lsof -nP -iTCP -sTCP:LISTEN", parseLsof(out), nil
	default: // linux and other unixes
		if out, err := runCmd(ctx, "ss", "-tlnpH"); err == nil {
			return "ss -tlnp", parseSS(out), nil
		}
		out, err := runCmd(ctx, "netstat", "-tlnp")
		if err != nil {
			return "", nil, err
		}
		return "netstat -tlnp", parseNetstatLinux(out), nil
	}
}

// splitHostPort splits "0.0.0.0:135", "[::]:445" or "127.0.0.1:8080" into the
// host and numeric port, tolerating IPv6 brackets.
func splitHostPort(s string) (string, int) {
	i := strings.LastIndex(s, ":")
	if i < 0 {
		return s, 0
	}
	host := s[:i]
	port, _ := strconv.Atoi(s[i+1:])
	return host, port
}

func parseNetstatWindows(out string, names map[int]string) []PortEntry {
	var entries []PortEntry
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 5 || !strings.EqualFold(f[0], "TCP") {
			continue
		}
		if !strings.EqualFold(f[3], "LISTENING") {
			continue
		}
		host, port := splitHostPort(f[1])
		pid, _ := strconv.Atoi(f[4])
		entries = append(entries, PortEntry{
			Protocol: "tcp", Address: host, Port: port, PID: pid, Process: names[pid],
		})
	}
	return entries
}

func windowsPIDNames(ctx context.Context) map[int]string {
	names := map[int]string{}
	out, err := runCmd(ctx, "tasklist", "/fo", "csv", "/nh")
	if err != nil {
		return names
	}
	for _, line := range strings.Split(out, "\n") {
		cols := strings.Split(line, "\",\"")
		if len(cols) < 2 {
			continue
		}
		name := strings.Trim(cols[0], "\" ")
		pid, err := strconv.Atoi(strings.Trim(cols[1], "\" "))
		if err == nil {
			names[pid] = name
		}
	}
	return names
}

var ssProcRe = regexp.MustCompile(`users:\(\("([^"]+)",pid=(\d+)`)

func parseSS(out string) []PortEntry {
	var entries []PortEntry
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 || !strings.EqualFold(f[0], "LISTEN") {
			continue
		}
		host, port := splitHostPort(f[3])
		host = strings.Trim(host, "[]")
		e := PortEntry{Protocol: "tcp", Address: host, Port: port}
		if m := ssProcRe.FindStringSubmatch(line); m != nil {
			e.Process = m[1]
			e.PID, _ = strconv.Atoi(m[2])
		}
		entries = append(entries, e)
	}
	return entries
}

func parseNetstatLinux(out string) []PortEntry {
	var entries []PortEntry
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 6 || !strings.HasPrefix(strings.ToLower(f[0]), "tcp") {
			continue
		}
		if !strings.EqualFold(f[5], "LISTEN") {
			continue
		}
		host, port := splitHostPort(f[3])
		host = strings.Trim(host, "[]")
		e := PortEntry{Protocol: "tcp", Address: host, Port: port}
		// Last column is "pid/name" when run with privileges, "-" otherwise.
		if len(f) >= 7 {
			if pidName := strings.SplitN(f[6], "/", 2); len(pidName) == 2 {
				e.PID, _ = strconv.Atoi(pidName[0])
				e.Process = pidName[1]
			}
		}
		entries = append(entries, e)
	}
	return entries
}

func parseLsof(out string) []PortEntry {
	var entries []PortEntry
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 9 || f[0] == "COMMAND" {
			continue
		}
		// Find the NAME token that holds the address (the one before "(LISTEN)").
		addrTok := ""
		for i, tok := range f {
			if tok == "(LISTEN)" && i > 0 {
				addrTok = f[i-1]
				break
			}
		}
		if addrTok == "" {
			continue
		}
		host, port := splitHostPort(addrTok)
		host = strings.Trim(host, "[]")
		pid, _ := strconv.Atoi(f[1])
		entries = append(entries, PortEntry{
			Protocol: "tcp", Address: host, Port: port, PID: pid, Process: f[0],
		})
	}
	return entries
}
