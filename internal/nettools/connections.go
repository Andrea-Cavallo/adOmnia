package nettools

import (
	"context"
	"runtime"
	"strconv"
	"strings"
)

// Connection is one established TCP connection and the process that owns its local end.
type Connection struct {
	LocalPort  int    `json:"localPort"`
	RemoteHost string `json:"remoteHost"`
	RemotePort int    `json:"remotePort"`
	PID        int    `json:"pid"`
}

// ListEstablished returns the machine's established TCP connections (IPv4 and IPv6)
// with their owning PID: netstat on Windows, ss/netstat on Linux, lsof on macOS.
func ListEstablished(ctx context.Context) ([]Connection, error) {
	switch runtime.GOOS {
	case "windows":
		out, err := runCmd(ctx, "netstat", "-ano")
		if err != nil {
			return nil, err
		}
		return parseEstablishedNetstatWindows(out), nil
	case "darwin":
		out, err := runCmd(ctx, "lsof", "-nP", "-iTCP", "-sTCP:ESTABLISHED")
		if err != nil {
			return nil, err
		}
		return parseEstablishedLsof(out), nil
	default:
		if out, err := runCmd(ctx, "ss", "-tnpH", "state", "established"); err == nil {
			return parseEstablishedSS(out), nil
		}
		out, err := runCmd(ctx, "netstat", "-tnp")
		if err != nil {
			return nil, err
		}
		return parseEstablishedNetstatLinux(out), nil
	}
}

func connection(local, remote string, pid int) (Connection, bool) {
	_, localPort := splitHostPort(local)
	host, remotePort := splitHostPort(remote)
	if localPort == 0 || remotePort == 0 {
		return Connection{}, false
	}
	return Connection{LocalPort: localPort, RemoteHost: strings.Trim(host, "[]"), RemotePort: remotePort, PID: pid}, true
}

// "  TCP    127.0.0.1:52144    127.0.0.1:5432    ESTABLISHED    4242"
func parseEstablishedNetstatWindows(out string) []Connection {
	var conns []Connection
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 5 || !strings.EqualFold(f[0], "TCP") || !strings.EqualFold(f[3], "ESTABLISHED") {
			continue
		}
		pid, _ := strconv.Atoi(f[4])
		if c, ok := connection(f[1], f[2], pid); ok {
			conns = append(conns, c)
		}
	}
	return conns
}

// ss -tnpH state established: "0 0 127.0.0.1:52144 127.0.0.1:5432 users:(("api",pid=4242,fd=7))"
func parseEstablishedSS(out string) []Connection {
	var conns []Connection
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		pid := 0
		if m := ssProcRe.FindStringSubmatch(line); m != nil {
			pid, _ = strconv.Atoi(m[2])
		}
		if c, ok := connection(f[2], f[3], pid); ok {
			conns = append(conns, c)
		}
	}
	return conns
}

// netstat -tnp: "tcp 0 0 127.0.0.1:52144 127.0.0.1:5432 ESTABLISHED 4242/api"
func parseEstablishedNetstatLinux(out string) []Connection {
	var conns []Connection
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 7 || !strings.HasPrefix(strings.ToLower(f[0]), "tcp") || !strings.EqualFold(f[5], "ESTABLISHED") {
			continue
		}
		pid, _ := strconv.Atoi(strings.SplitN(f[6], "/", 2)[0])
		if c, ok := connection(f[3], f[4], pid); ok {
			conns = append(conns, c)
		}
	}
	return conns
}

// lsof: "api 4242 me 7u IPv4 0x… 0t0 TCP 127.0.0.1:52144->127.0.0.1:5432 (ESTABLISHED)"
func parseEstablishedLsof(out string) []Connection {
	var conns []Connection
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 9 || f[0] == "COMMAND" {
			continue
		}
		pid, _ := strconv.Atoi(f[1])
		for _, tok := range f {
			if local, remote, ok := strings.Cut(tok, "->"); ok {
				if c, ok := connection(local, remote, pid); ok {
					conns = append(conns, c)
				}
			}
		}
	}
	return conns
}
