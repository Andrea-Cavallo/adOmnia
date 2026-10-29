package main

import (
	"context"
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel/auditskill"
)

// Binding della skill security-audit di Cloudflare nel Security Center. L'audit lo esegue l'agente scelto
// nella chat AI di Code Studio, come Agent Task: qui solo installazione esplicita, prompt e lettura dei risultati.

// AuditSkillInfo dice se la skill è installata e dove.
func (s *SecurityIntel) AuditSkillInfo() (string, error) {
	status, err := auditskill.Detect()
	if err != nil {
		return "", err
	}
	return asJSON(status)
}

// AuditSkillInstallPlan è il download da mostrare nella conferma.
func (s *SecurityIntel) AuditSkillInstallPlan() (string, error) {
	plan, err := auditskill.PlanInstall()
	if err != nil {
		return "", err
	}
	return asJSON(plan)
}

// AuditSkillInstall scarica la skill al commit fissato; confirmed deve essere true.
func (s *SecurityIntel) AuditSkillInstall(confirmed bool) (string, error) {
	if !confirmed {
		return "", fmt.Errorf("installing the security-audit skill needs explicit confirmation")
	}
	status, err := auditskill.Install(context.Background())
	if err != nil {
		return "", err
	}
	return asJSON(status)
}

// AuditSkillPrepare sceglie la cartella della prossima run e scrive il prompt per l'agente.
func (s *SecurityIntel) AuditSkillPrepare(root, profile, focus string) (string, error) {
	prepared, err := auditskill.Prepare(root, profile, focus)
	if err != nil {
		return "", err
	}
	return asJSON(prepared)
}

// AuditSkillRuns elenca le run del progetto.
func (s *SecurityIntel) AuditSkillRuns(root string) (string, error) {
	runs, err := auditskill.Runs(root)
	if err != nil {
		return "", err
	}
	return asJSON(runs)
}

// AuditSkillReport legge findings.json e REPORT.md della run indicata.
func (s *SecurityIntel) AuditSkillReport(root string, run int) (string, error) {
	report, err := auditskill.ReadReport(root, run)
	if err != nil {
		return "", err
	}
	return asJSON(report)
}
