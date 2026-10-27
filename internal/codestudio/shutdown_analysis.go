package codestudio

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/startup"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// ShutdownReport: dall'avvio al segnale di arresto, fino all'uscita (o al timeout).
type ShutdownReport struct {
	Target   string           `json:"target"`
	Ready    bool             `json:"ready"`
	ReadyMs  float64          `json:"readyMs"`
	Shutdown startup.Shutdown `json:"shutdown"`
	Events   []startup.Event  `json:"events"` // dal segnale in poi
}

var helperMu sync.Mutex

// interruptHelper compila (una volta, in cache) l'helper che manda CTRL_BREAK su Windows.
func (s *Service) interruptHelper(ctx context.Context, built executable) (string, error) {
	path := process.InterruptHelperPath()
	if path == "" {
		return "", nil
	}
	helperMu.Lock()
	defer helperMu.Unlock()
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	temp, err := os.MkdirTemp("", "adomnia-ctrlbreak-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temp)
	source := filepath.Join(temp, "main.go")
	if err := os.WriteFile(source, []byte(process.InterruptHelperSource), 0o644); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	command := procutil.CommandContext(ctx, built.goBinary, "build", "-o", path, source)
	command.Dir, command.Env = temp, append(append([]string(nil), built.environment...), "GO111MODULE=off")
	configureProcess(command, false)
	if output, err := command.CombinedOutput(); err != nil {
		return "", &shutdownError{cleanToolError(output, 0)}
	}
	return path, nil
}

type shutdownError struct{ message string }

func (e *shutdownError) Error() string { return "building the interrupt helper: " + e.message }

// ShutdownAnalysis avvia target finché è pronto, gli manda l'interrupt e osserva l'arresto per grace secondi.
func (s *Service) ShutdownAnalysis(sessionID, target, health string, graceSeconds int) (ShutdownReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ShutdownReport{}, err
	}
	target = strings.TrimSpace(target)
	if target == "" {
		target = "."
	}
	if health = strings.TrimSpace(health); health != "" && !strings.HasPrefix(health, "/") {
		health = "/" + health
	}
	if graceSeconds <= 0 || graceSeconds > 120 {
		graceSeconds = 10
	}
	ctx, cancel := context.WithTimeout(context.Background(), binaryBuildTimeout+time.Duration(30+graceSeconds)*time.Second)
	defer cancel()
	built, err := s.buildExecutable(ctx, sessionID, session.Project.RealPath, target)
	if err != nil {
		return ShutdownReport{}, err
	}
	defer built.cleanup()
	helper, err := s.interruptHelper(ctx, built)
	if err != nil {
		return ShutdownReport{}, err
	}
	command := procutil.Command(built.path)
	command.Dir, command.Env = session.Project.RealPath, built.environment
	process.ConfigureInterruptible(command)
	running, err := startup.Start(ctx, command, startup.Options{Health: health, Timeout: 30 * time.Second})
	if err != nil {
		return ShutdownReport{}, err
	}
	readyTimeline := running.Snapshot()
	report := ShutdownReport{Target: target, Events: []startup.Event{}}
	for _, event := range readyTimeline.Events {
		if event.Kind == "ready" {
			report.Ready, report.ReadyMs = true, event.AtMs
		}
	}
	time.Sleep(300 * time.Millisecond) // le connessioni del pool si stabilizzano
	report.Shutdown = startup.ObserveShutdown(ctx, running, func() error { return process.Interrupt(command.Process.Pid, helper) }, time.Duration(graceSeconds)*time.Second, func() { _ = terminateProcessTree(command) })
	for _, event := range report.Shutdown.Timeline.Events {
		if event.AtMs >= report.Shutdown.SignalAtMs {
			report.Events = append(report.Events, event)
		}
	}
	report.Shutdown.Timeline = startup.Timeline{}
	return report, nil
}
