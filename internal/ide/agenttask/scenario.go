package agenttask

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/acceptance"
)

// AddScenario turns the executable criteria of an acceptance scenario into task
// verifications, linked to the scenario and criterion: running them records the same
// evidence as any other verification. Criteria already added are skipped.
func (service *Service) AddScenario(id string, scenario acceptance.Scenario) (Task, error) {
	return service.updateTask(id, func(task *Task, now time.Time) error {
		added := 0
		for _, criterion := range scenario.Criteria {
			if criterion.Check == nil {
				continue
			}
			if slices.ContainsFunc(task.Verifications, func(existing Verification) bool {
				return existing.ScenarioID == scenario.ID && existing.CriterionID == criterion.ID
			}) {
				continue
			}
			if len(task.Verifications) >= maxVerificationsPerTask {
				return fmt.Errorf("at most %d verifications can be stored per task", maxVerificationsPerTask)
			}
			normalized, err := normalizeVerificationDraft(checkDraft(scenario, criterion))
			if err != nil {
				return fmt.Errorf("criterion %s: %w", criterion.ID, err)
			}
			task.Verifications = append(task.Verifications, Verification{
				ID: newID("verify"), Kind: normalized.Kind, Label: normalized.Label,
				Language: normalized.Language, Packages: normalized.Packages, Run: normalized.Run,
				Method: normalized.Method, URL: normalized.URL, Headers: normalized.Headers,
				Body: normalized.Body, ExpectedStatus: normalized.ExpectedStatus,
				TimeoutSeconds: normalized.TimeoutSeconds, CreatedAt: now,
				ScenarioID: scenario.ID, CriterionID: criterion.ID,
			})
			added++
		}
		if added == 0 {
			return errors.New("this scenario has no executable criterion that is not already on the task")
		}
		rememberScenario(task, scenario)
		return nil
	})
}

func checkDraft(scenario acceptance.Scenario, criterion acceptance.Criterion) VerificationDraft {
	check := criterion.Check
	label := check.Label
	if label == "" {
		label = fmt.Sprintf("%s · %s", scenario.ID, criterion.Text)
		if len(label) > maxVerificationLabel {
			label = label[:maxVerificationLabel-1] + "…"
		}
	}
	headers := make([]VerificationHeader, 0, len(check.Headers))
	for _, name := range slices.Sorted(maps.Keys(check.Headers)) {
		headers = append(headers, VerificationHeader{Name: name, Value: check.Headers[name]})
	}
	return VerificationDraft{
		Kind: VerificationKind(check.Kind), Label: label, Language: check.Language,
		Packages: check.Packages, Run: check.Run, Method: check.Method, URL: check.URL,
		Headers: headers, Body: check.Body, ExpectedStatus: check.ExpectedStatus, TimeoutSeconds: check.TimeoutSeconds,
	}
}

// ScenarioRef is the snapshot of a scenario kept on the task for the agent prompts.
type ScenarioRef struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Criteria []string `json:"criteria"`
}

func rememberScenario(task *Task, scenario acceptance.Scenario) {
	ref := ScenarioRef{ID: scenario.ID, Title: scenario.Title, Criteria: []string{}}
	for _, criterion := range scenario.Criteria {
		ref.Criteria = append(ref.Criteria, criterion.Text)
	}
	for index := range task.Scenarios {
		if task.Scenarios[index].ID == scenario.ID {
			task.Scenarios[index] = ref
			return
		}
	}
	task.Scenarios = append(task.Scenarios, ref)
}

// scenariosMessage renders the task's acceptance scenarios for a prompt.
func scenariosMessage(scenarios []ScenarioRef) string {
	if len(scenarios) == 0 {
		return ""
	}
	var builder strings.Builder
	builder.WriteString("\nAcceptance scenarios (versioned in the project; adOmnia verifies the executable criteria):\n")
	for _, scenario := range scenarios {
		fmt.Fprintf(&builder, "- %s — %s\n", scenario.ID, scenario.Title)
		for _, criterion := range scenario.Criteria {
			fmt.Fprintf(&builder, "  - %s\n", criterion)
		}
	}
	return builder.String()
}
