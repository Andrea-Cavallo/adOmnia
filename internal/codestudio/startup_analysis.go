package codestudio

import (
	"context"
	"os/exec"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/startup"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// StartupReport è l'avvio di un servizio misurato da Code Studio.
type StartupReport struct {
	Target  string            `json:"target"`
	Ready   bool              `json:"ready"`
	ReadyMs float64           `json:"readyMs"`
	Port    int               `json:"port,omitzero"`
	Events  []startup.Event   `json:"events"`
	Inits   []golang.InitStep `json:"inits"`
	InitMs  float64           `json:"initMs"`
}

// StartupAnalysis compila target, lo avvia con GODEBUG=inittrace=1 e l'ambiente dei run, ne osserva
// l'avvio (init dei package, output, connessioni, porta, health) e lo ferma appena pronto.
func (s *Service) StartupAnalysis(sessionID, target, health string, timeoutSeconds int) (StartupReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return StartupReport{}, err
	}
	target = strings.TrimSpace(target)
	if target == "" {
		target = "."
	}
	if health = strings.TrimSpace(health); health != "" && !strings.HasPrefix(health, "/") {
		health = "/" + health
	}
	if timeoutSeconds <= 0 || timeoutSeconds > 300 {
		timeoutSeconds = 30
	}
	ctx, cancel := context.WithTimeout(context.Background(), binaryBuildTimeout+time.Duration(timeoutSeconds)*time.Second)
	defer cancel()
	built, err := s.buildExecutable(ctx, sessionID, session.Project.RealPath, target)
	if err != nil {
		return StartupReport{}, err
	}
	defer built.cleanup()
	command := procutil.CommandContext(ctx, built.path)
	command.Dir = session.Project.RealPath
	command.Env = append(append([]string(nil), built.environment...), "GODEBUG=inittrace=1")
	configureProcess(command, false)
	timeline, err := startup.Observe(ctx, command, startup.Options{Health: health, Timeout: time.Duration(timeoutSeconds) * time.Second}, func(c *exec.Cmd) { _ = terminateProcessTree(c) })
	if err != nil {
		return StartupReport{}, err
	}
	report := StartupReport{Target: target, Ready: timeline.Ready, ReadyMs: timeline.ReadyMs, Port: timeline.Port, Events: []startup.Event{}, Inits: golang.ParseInitTrace(timeline.Lines)}
	for _, step := range report.Inits {
		report.InitMs += step.ClockMs
	}
	if len(report.Inits) > 25 {
		report.Inits = report.Inits[:25]
	}
	for _, event := range timeline.Events {
		if event.Kind == "output" && strings.HasPrefix(event.Detail, "init ") && strings.Contains(event.Detail, " ms clock") {
			continue // già nelle init
		}
		report.Events = append(report.Events, event)
	}
	return report, nil
}
