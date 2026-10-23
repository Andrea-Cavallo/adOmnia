package main

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"os/exec"

	"adomnia/internal/ai"
	"adomnia/internal/securityintel/strix"
	"adomnia/internal/jsonutil"
)

// Binding Strix del Security Center. Il binding resta sottile: la logica vive in internal/securityintel/strix.
// Le scansioni sono azioni esplicite dell'utente: il frontend mostra prima dove va il codice (provider LLM) e
// il comando esatto di installazione, e passa qui solo ciò che l'utente ha confermato.

func asJSON(value any) (string, error) {
	data, err := jsonutil.Marshal(value)
	return string(data), err
}

// StrixInfo dice se Strix e Docker sono pronti.
func (s *SecurityIntel) StrixInfo() (string, error) {
	return asJSON(strix.Detect(context.Background()))
}

// StrixInstallPlan restituisce il comando che verrà eseguito per installare Strix (da mostrare nella conferma).
func (s *SecurityIntel) StrixInstallPlan() (string, error) {
	plan, err := strix.PlanInstall()
	if err != nil {
		return "", err
	}
	return asJSON(plan)
}

// StrixInstall installa Strix con il piano mostrato; confirmed deve essere true.
func (s *SecurityIntel) StrixInstall(confirmed bool) (string, error) {
	if !confirmed {
		return "", fmt.Errorf("installing Strix needs explicit confirmation")
	}
	plan, err := strix.PlanInstall()
	if err != nil {
		return "", err
	}
	run, err := s.strixManager().Install(plan)
	if err != nil {
		return "", err
	}
	return asJSON(run)
}

// StrixStart lancia la scansione di una copia del progetto. aiConfigJSON è la configurazione AI di adOmnia
// (la stessa dell'AI Engine); customModel, se non vuoto, è un id LiteLLM scritto dall'utente.
// confirmed attesta che l'utente ha accettato che il codice vada al provider LLM.
func (s *SecurityIntel) StrixStart(optionsJSON, aiConfigJSON, customModel string, confirmed bool) (string, error) {
	if !confirmed {
		return "", fmt.Errorf("a Strix scan sends project code to your AI provider and needs explicit confirmation")
	}
	var options strix.Options
	if err := json.Unmarshal([]byte(optionsJSON), &options); err != nil {
		return "", fmt.Errorf("invalid scan options: %w", err)
	}
	var cfg ai.Config
	if err := json.Unmarshal([]byte(aiConfigJSON), &cfg); err != nil {
		return "", fmt.Errorf("invalid AI configuration: %w", err)
	}
	cfg, err := ai.ResolveEnvironmentCredentials(cfg)
	if err != nil {
		return "", err
	}
	var llm strix.LLM
	if customModel != "" {
		llm = strix.LLM{Model: customModel, APIKey: cfg.APIKey, BaseURL: cfg.BaseURL}
	} else if llm, err = strix.LLMFromProvider(string(cfg.Provider), cfg.Model, cfg.APIKey, cfg.BaseURL); err != nil {
		return "", err
	}
	run, err := s.strixManager().Start(options, llm)
	if err != nil {
		return "", err
	}
	return asJSON(run)
}

// StrixStatus restituisce lo stato della run e le righe di output successive a since.
func (s *SecurityIntel) StrixStatus(runID string, since int) (string, error) {
	run, err := s.strixManager().Status(runID, since)
	if err != nil {
		return "", err
	}
	return asJSON(run)
}

// StrixCancel ferma la scansione.
func (s *SecurityIntel) StrixCancel(runID string) error { return s.strixManager().Cancel(runID) }

// StrixReport legge problemi e report scritti da Strix.
func (s *SecurityIntel) StrixReport(runID string) (string, error) {
	report, err := s.strixManager().Report(runID)
	if err != nil {
		return "", err
	}
	return asJSON(report)
}

// StrixExport è il report completo in Markdown.
func (s *SecurityIntel) StrixExport(runID string) (string, error) {
	return s.strixManager().Export(runID)
}

// GovulncheckInstallPlan è il comando che ricompila govulncheck con il Go corrente (da mostrare nella conferma).
func (s *SecurityIntel) GovulncheckInstallPlan() (string, error) {
	plan, err := govulncheckPlan()
	if err != nil {
		return "", err
	}
	return asJSON(plan)
}

// InstallGovulncheck esegue `go install` di govulncheck dopo il consenso dell'utente. Serve quando govulncheck è
// stato compilato con un Go più vecchio di quello del progetto e non riesce a leggerne i package. L'output si
// segue con StrixStatus, che vale per qualunque installazione avviata dal manager.
func (s *SecurityIntel) InstallGovulncheck(confirmed bool) (string, error) {
	if !confirmed {
		return "", fmt.Errorf("installing govulncheck needs explicit confirmation")
	}
	plan, err := govulncheckPlan()
	if err != nil {
		return "", err
	}
	run, err := s.strixManager().Install(plan)
	if err != nil {
		return "", err
	}
	return asJSON(run)
}

func govulncheckPlan() (strix.InstallPlan, error) {
	goBinary, err := exec.LookPath("go")
	if err != nil {
		return strix.InstallPlan{}, fmt.Errorf("the Go toolchain was not found in PATH")
	}
	return strix.InstallPlan{
		Command: "go install golang.org/x/vuln/cmd/govulncheck@latest",
		Program: goBinary,
		Args:    []string{"install", "golang.org/x/vuln/cmd/govulncheck@latest"},
		Note:    "Rebuilds govulncheck with the Go version installed on this machine. It downloads the module through your Go proxy and installs it in your Go bin folder.",
	}, nil
}
