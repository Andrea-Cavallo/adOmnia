package kube

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
)

// Forward is one running `kubectl port-forward`, bound to 127.0.0.1 only.
type Forward struct {
	ID         string `json:"id"`
	Context    string `json:"context"`
	Namespace  string `json:"namespace"`
	Target     string `json:"target"` // pod/<name> or svc/<name>
	LocalPort  int    `json:"localPort"`
	RemotePort int    `json:"remotePort"`
	Running    bool   `json:"running"`
	Status     string `json:"status"` // last line kubectl printed
	StartedAt  int64  `json:"startedAt"`

	cancel context.CancelFunc
}

var (
	forwards   = map[string]*Forward{}
	forwardsMu sync.Mutex
	forwardSeq int64
)

func validPort(port int) bool { return port > 0 && port < 65536 }

// freeLocalPort asks the OS for a free loopback port (local port 0 = "pick one for me").
// ponytail: the port is released before kubectl binds it; a race is possible but kubectl then fails visibly.
func freeLocalPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("no free local port: %w", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

// StartForward opens a port forward to a pod or service; localPort 0 picks a free port. The process lives
// until StopForward, sidecar shutdown, or kubectl exits on its own.
func StartForward(contextName, namespace, target string, localPort, remotePort int) (*Forward, error) {
	if !Available() {
		return nil, fmt.Errorf("kubectl is not installed or not on PATH")
	}
	if err := validateIdentifier(namespace, "namespace"); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(target, "pod/") && !strings.HasPrefix(target, "svc/") {
		return nil, fmt.Errorf("forward a pod/ or svc/ target")
	}
	if err := validateIdentifier(strings.SplitN(target, "/", 2)[1], "target"); err != nil {
		return nil, err
	}
	if localPort == 0 {
		free, err := freeLocalPort()
		if err != nil {
			return nil, err
		}
		localPort = free
	}
	if !validPort(localPort) || !validPort(remotePort) {
		return nil, fmt.Errorf("ports must be between 1 and 65535")
	}
	args, err := withContext([]string{"port-forward", target, fmt.Sprintf("%d:%d", localPort, remotePort),
		"-n", namespace, "--address", "127.0.0.1"}, contextName)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, "kubectl", args...)
	hideConsole(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("could not start kubectl port-forward: %w", err)
	}

	forwardsMu.Lock()
	forwardSeq++
	forward := &Forward{
		ID: fmt.Sprintf("pf-%d", forwardSeq), Context: contextName, Namespace: namespace, Target: target,
		LocalPort: localPort, RemotePort: remotePort, Running: true, Status: "starting…",
		StartedAt: time.Now().UnixMilli(), cancel: cancel,
	}
	forwards[forward.ID] = forward
	forwardsMu.Unlock()

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if line := strings.TrimSpace(scanner.Text()); line != "" {
				forwardsMu.Lock()
				forward.Status = line
				forwardsMu.Unlock()
			}
		}
		waitErr := cmd.Wait()
		forwardsMu.Lock()
		forward.Running = false
		if ctx.Err() != nil {
			forward.Status = "stopped"
		} else if waitErr != nil && !strings.Contains(forward.Status, "error") {
			forward.Status = "exited: " + waitErr.Error()
		}
		forwardsMu.Unlock()
	}()
	return forward, nil
}

// ListForwards returns a snapshot of every forward, newest first.
func ListForwards() []Forward {
	forwardsMu.Lock()
	defer forwardsMu.Unlock()
	out := make([]Forward, 0, len(forwards))
	for _, f := range forwards {
		out = append(out, Forward{ID: f.ID, Context: f.Context, Namespace: f.Namespace, Target: f.Target,
			LocalPort: f.LocalPort, RemotePort: f.RemotePort, Running: f.Running, Status: f.Status, StartedAt: f.StartedAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out
}

// StopForward stops and forgets one forward.
func StopForward(id string) {
	forwardsMu.Lock()
	forward := forwards[id]
	delete(forwards, id)
	forwardsMu.Unlock()
	if forward != nil {
		forward.cancel()
	}
}

// CloseAll stops every forward, on sidecar shutdown.
func CloseAll() {
	forwardsMu.Lock()
	all := forwards
	forwards = map[string]*Forward{}
	forwardsMu.Unlock()
	for _, f := range all {
		f.cancel()
	}
}
