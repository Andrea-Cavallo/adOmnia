package agenttask

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// PRDraft is an editable pull request title and body built from what adOmnia measured:
// it states what was verified and what was not, never more than the evidence shows.
type PRDraft struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// DraftPullRequest builds the draft from the task, its plan, linked scenarios and the
// latest evidence of each verification. Nothing is pushed or sent anywhere.
func (service *Service) DraftPullRequest(id string) (PRDraft, error) {
	task, err := service.Get(id)
	if err != nil {
		return PRDraft{}, err
	}
	if strings.TrimSpace(task.Objective) == "" {
		return PRDraft{}, errors.New("the task has no objective to describe")
	}
	return prDraft(task), nil
}

func prDraft(task Task) PRDraft {
	title, _, _ := strings.Cut(strings.TrimSpace(task.Objective), "\n")
	if len(title) > 72 {
		title = strings.TrimSpace(title[:71]) + "…"
	}
	var body strings.Builder
	body.WriteString("## Summary\n\n")
	body.WriteString(strings.TrimSpace(task.Objective))
	body.WriteString("\n")
	if len(task.Criteria) > 0 {
		body.WriteString("\n## Completion criteria\n\n")
		for _, criterion := range task.Criteria {
			fmt.Fprintf(&body, "- %s\n", criterion)
		}
	}
	writePlan(&body, task.Plan)
	writeVerification(&body, task)
	if task.Workspace != nil {
		fmt.Fprintf(&body, "\n---\nPrepared in adOmnia from branch `%s` (started at `%s`).\n", task.Workspace.Branch, shortSHA(task.Workspace.BaseSHA))
	}
	return PRDraft{Title: title, Body: body.String()}
}

func writePlan(body *strings.Builder, plan *Plan) {
	if plan == nil || len(plan.Steps) == 0 {
		return
	}
	body.WriteString("\n## Steps\n\n")
	for _, step := range plan.Steps {
		mark := " "
		if step.Status == StepCompleted {
			mark = "x"
		}
		note := ""
		switch {
		case step.ConfirmedWithoutVerification:
			note = " — confirmed by the author without verification"
		case step.Status != StepCompleted:
			note = " — " + strings.ReplaceAll(string(step.Status), "_", " ")
		}
		fmt.Fprintf(body, "- [%s] %s%s\n", mark, step.Title, note)
	}
}

// writeVerification lists each verification with its latest measured outcome, grouped
// by acceptance scenario, and says plainly what was not verified.
func writeVerification(body *strings.Builder, task Task) {
	body.WriteString("\n## Verification\n\n")
	if len(task.Verifications) == 0 {
		body.WriteString("No verification was recorded by adOmnia for this change.\n")
		return
	}
	var notVerified []string
	for _, verification := range task.Verifications {
		evidence, ok := latestEvidence(task.Evidences, verification.ID)
		label := verification.Label
		if verification.ScenarioID != "" {
			label = fmt.Sprintf("%s (scenario %s, criterion %s)", label, verification.ScenarioID, verification.CriterionID)
		}
		if !ok {
			notVerified = append(notVerified, label)
			continue
		}
		mark := map[EvidenceOutcome]string{EvidencePassed: "✅", EvidenceFailed: "❌", EvidenceError: "⚠️", EvidenceNotRun: "⏸"}[evidence.Outcome]
		fmt.Fprintf(body, "- %s %s — `%s`", mark, label, evidence.Command)
		if evidence.Outcome != EvidencePassed {
			fmt.Fprintf(body, " (%s)", strings.ReplaceAll(string(evidence.Outcome), "_", " "))
		}
		body.WriteString("\n")
	}
	if len(notVerified) > 0 {
		body.WriteString("\nNot verified:\n")
		for _, label := range notVerified {
			fmt.Fprintf(body, "- %s\n", label)
		}
	}
}

func latestEvidence(evidences []Evidence, verificationID string) (Evidence, bool) {
	for _, evidence := range slices.Backward(evidences) {
		if evidence.VerificationID == verificationID {
			return evidence, true
		}
	}
	return Evidence{}, false
}
