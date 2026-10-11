package startup

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"adomnia/internal/nettools"
)

// Shutdown è ciò che succede dopo il segnale di arresto.
type Shutdown struct {
	Timeline      Timeline `json:"timeline"`
	SignalAtMs    float64  `json:"signalAtMs"`
	ExitAtMs      float64  `json:"exitAtMs"`
	Exited        bool     `json:"exited"`
	ExitCode      int      `json:"exitCode"`
	TimedOut      bool     `json:"timedOut"`
	StillOpen     []string `json:"stillOpen"`     // connessioni aperte al momento del timeout
	GoroutineDump string   `json:"goroutineDump"` // /debug/pprof/goroutine?debug=1 se il servizio lo espone
}

// ObserveShutdown manda il segnale con interrupt, segue chiusura della porta, delle connessioni e
// l'uscita; dopo grace il processo che non esce è descritto (connessioni, goroutine) e poi fermato con kill.
func ObserveShutdown(ctx context.Context, running *Running, interrupt func() error, grace time.Duration, kill func()) Shutdown {
	result := Shutdown{StillOpen: []string{}}
	pid := running.Command.Process.Pid
	port := running.Port()
	open := map[int]bool{}
	if conns, err := nettools.ListEstablished(ctx); err == nil {
		for _, conn := range conns {
			if conn.PID == pid {
				open[conn.RemotePort] = true
			}
		}
	}
	listening := port != 0
	result.SignalAtMs = running.Since()
	if err := interrupt(); err != nil {
		running.Add("signal", "could not send the interrupt: "+err.Error())
	} else {
		running.Add("signal", "interrupt sent")
	}
	deadline := time.NewTimer(grace)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
loop:
	for {
		select {
		case <-running.Exited:
			result.Exited, result.ExitAtMs = true, running.Since()
			break loop
		case <-deadline.C:
			result.TimedOut = true
			running.Add("timeout", fmt.Sprintf("still running %s after the signal", grace))
			break loop
		case <-ticker.C:
			poll, cancel := context.WithTimeout(ctx, 3*time.Second)
			if listening {
				if ports, err := nettools.ListListeningPorts(poll); err == nil {
					still := false
					for _, entry := range ports {
						still = still || (entry.PID == pid && entry.Port == port)
					}
					if !still {
						listening = false
						running.Add("unlisten", ":"+strconv.Itoa(port)+" closed")
					}
				}
			}
			if conns, err := nettools.ListEstablished(poll); err == nil {
				now := map[int]bool{}
				for _, conn := range conns {
					if conn.PID == pid {
						now[conn.RemotePort] = true
					}
				}
				for remote := range open {
					if !now[remote] {
						delete(open, remote)
						running.Add("disconnect", Kind(remote))
					}
				}
			}
			cancel()
		}
	}
	if result.TimedOut {
		for remote := range open {
			result.StillOpen = append(result.StillOpen, Kind(remote))
		}
		if port != 0 {
			client := &http.Client{Timeout: 2 * time.Second}
			if response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/debug/pprof/goroutine?debug=1", port)); err == nil {
				body, _ := io.ReadAll(io.LimitReader(response.Body, 256*1024))
				_ = response.Body.Close()
				if response.StatusCode == http.StatusOK && strings.Contains(string(body), "goroutine profile") {
					result.GoroutineDump = string(body)
				}
			}
		}
		kill()
	}
	result.Timeline = running.Finish(5 * time.Second)
	if state := running.Command.ProcessState; state != nil {
		result.ExitCode = state.ExitCode()
		if !result.Exited {
			result.ExitAtMs = running.Since()
		}
	}
	return result
}
