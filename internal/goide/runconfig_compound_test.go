package goide

import (
	"testing"
	"time"
)

// waitRuns polls until the session has want runs, all finished.
func waitRuns(t *testing.T, service *Service, sessionID string, want int) []Execution {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		runs, err := service.ListRuns(sessionID)
		if err != nil {
			t.Fatal(err)
		}
		finished := 0
		for _, run := range runs {
			if run.FinishedAt != nil {
				finished++
			}
		}
		if len(runs) >= want && finished == len(runs) {
			return runs
		}
		time.Sleep(100 * time.Millisecond)
	}
	runs, _ := service.ListRuns(sessionID)
	t.Fatalf("expected %d finished runs, got %#v", want, runs)
	return nil
}

func TestCompoundRunsTasksBeforeMembers(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/stack\n\ngo 1.26\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	save := func(config RunConfiguration) RunConfiguration {
		t.Helper()
		saved, err := service.SaveRunConfiguration(id, config)
		if err != nil {
			t.Fatal(err)
		}
		return saved
	}
	migrate := save(RunConfiguration{Name: "migrate", Kind: RunKindCommand, Target: "go", ProgramArguments: []string{"env", "GOOS"}})
	seed := save(RunConfiguration{Name: "seed", Kind: RunKindGoTool, Target: "version"})
	api := save(RunConfiguration{Name: "api", Kind: RunKindGoTool, Target: "env"})
	worker := save(RunConfiguration{Name: "worker", Kind: RunKindCommand, Target: "go", ProgramArguments: []string{"env", "GOARCH"}})
	stack := save(RunConfiguration{Name: "Start workspace", Kind: RunKindCompound, Compound: []string{api.ID, worker.ID}, PreRun: []string{migrate.ID, seed.ID}})
	if len(stack.PreRun) != 2 {
		t.Fatalf("compound tasks dropped: %#v", stack.PreRun)
	}

	if _, err := service.StartConfiguredRun(id, stack.ID, nil); err != nil {
		t.Fatal(err)
	}
	runs := waitRuns(t, service, id, 4)
	var lastTaskEnd time.Time
	var firstMemberStart time.Time
	for _, run := range runs {
		switch run.Command {
		case "go env GOOS", "go version":
			if run.FinishedAt.After(lastTaskEnd) {
				lastTaskEnd = *run.FinishedAt
			}
		default:
			if firstMemberStart.IsZero() || run.StartedAt.Before(firstMemberStart) {
				firstMemberStart = run.StartedAt
			}
		}
	}
	if lastTaskEnd.IsZero() || firstMemberStart.IsZero() || firstMemberStart.Before(lastTaskEnd) {
		t.Fatalf("members must start after the tasks: tasks end %v, members start %v (%#v)", lastTaskEnd, firstMemberStart, runs)
	}
}

func TestCompoundStopsWhenATaskFails(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/broken\n\ngo 1.26\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	broken, _ := service.SaveRunConfiguration(id, RunConfiguration{Name: "migrate", Kind: RunKindCommand, Target: "go", ProgramArguments: []string{"no-such-subcommand"}})
	api, _ := service.SaveRunConfiguration(id, RunConfiguration{Name: "api", Kind: RunKindGoTool, Target: "version"})
	worker, _ := service.SaveRunConfiguration(id, RunConfiguration{Name: "worker", Kind: RunKindGoTool, Target: "env"})
	stack, err := service.SaveRunConfiguration(id, RunConfiguration{Name: "Start workspace", Kind: RunKindCompound, Compound: []string{api.ID, worker.ID}, PreRun: []string{broken.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartConfiguredRun(id, stack.ID, nil); err != nil {
		t.Fatal(err)
	}
	runs := waitRuns(t, service, id, 1)
	time.Sleep(500 * time.Millisecond)
	if runs, _ = service.ListRuns(id); len(runs) != 1 {
		t.Fatalf("a failed task must keep the services stopped, got %d runs", len(runs))
	}
}
