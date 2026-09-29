package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestToolConfigurationValidation(t *testing.T) {
	valid := []RunConfiguration{
		{Name: "make", Kind: RunKindMake, ProgramArguments: []string{"build", "VERSION=1.2"}},
		{Name: "img", Kind: RunKindDockerBuild, Docker: DockerOptions{Tag: "pdld/core:dev", Stage: "builder"}},
		{Name: "run", Kind: RunKindDockerRun, Docker: DockerOptions{Ports: []string{"8080", "8080:80", "127.0.0.1:9000:9000/tcp"}, Volumes: []string{"data:/data:ro"}}},
	}
	for _, config := range valid {
		normalized, err := normalizeConfiguration(config)
		if err != nil {
			t.Fatalf("%s: %v", config.Name, err)
		}
		if normalized.Target == "" || (config.Kind != RunKindMake && normalized.Docker.Context != ".") {
			t.Fatalf("%s: default mancanti: %#v", config.Name, normalized)
		}
	}
	invalid := []RunConfiguration{
		{Name: "flag", Kind: RunKindMake, ProgramArguments: []string{"--eval=x"}},
		{Name: "tag", Kind: RunKindDockerBuild, Docker: DockerOptions{Tag: "Upper:Case"}},
		{Name: "stage", Kind: RunKindDockerBuild, Docker: DockerOptions{Stage: "-x"}},
		{Name: "port", Kind: RunKindDockerRun, Docker: DockerOptions{Ports: []string{"80:80 --privileged"}}},
		{Name: "abs volume", Kind: RunKindDockerRun, Docker: DockerOptions{Volumes: []string{"/var/run/docker.sock:/var/run/docker.sock"}}},
		{Name: "rel ctr", Kind: RunKindDockerRun, Docker: DockerOptions{Volumes: []string{"data:data"}}},
		{Name: "arg", Kind: RunKindDockerBuild, Docker: DockerOptions{BuildArgs: []EnvironmentEntry{{Key: "A=B"}}}},
	}
	for _, config := range invalid {
		if _, err := normalizeConfiguration(config); err == nil {
			t.Fatalf("%s: configurazione non valida accettata", config.Name)
		}
	}
	root := t.TempDir()
	if err := validateToolPaths(root, root, RunKindDockerRun, "Dockerfile", DockerOptions{Context: ".", Volumes: []string{"../outside:/x"}}); err == nil {
		t.Fatal("volume fuori dal progetto accettato")
	}
	if err := validateToolPaths(root, root, RunKindDockerBuild, "Dockerfile", DockerOptions{Context: ".."}); err == nil {
		t.Fatal("contesto fuori dal progetto accettato")
	}
}

func TestDockerSecretsNeverReachCommandLineOrState(t *testing.T) {
	options := DockerOptions{BuildArgs: []EnvironmentEntry{{Key: "username", Value: "andrea"}, {Key: "password", Value: "s3cret", Secret: true}}}
	arguments := dockerBuildArguments("Dockerfile", "app:dev", ".", options, secretSet([]string{"password"}))
	line := strings.Join(arguments, " ")
	if strings.Contains(line, "s3cret") || !strings.Contains(line, "--build-arg password") || !strings.Contains(line, "--build-arg username=andrea") {
		t.Fatalf("argomenti docker inattesi: %s", line)
	}
	overrides := toolEnvironment("docker-build", RunRequest{Docker: options, Secrets: []string{"password"}, Environment: map[string]string{"PATH": "container"}})
	if overrides["password"] != "s3cret" || len(overrides) != 1 {
		t.Fatalf("l'ambiente del client docker deve contenere solo i segreti: %#v", overrides)
	}

	manager := NewRunConfigManager()
	saved, err := manager.Save("s1", RunConfiguration{Name: "img", Kind: RunKindDockerBuild, Docker: options})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(saved.RequiredSecrets(), []string{"password"}) {
		t.Fatalf("segreti richiesti: %v", saved.RequiredSecrets())
	}
	for _, config := range manager.Snapshot() {
		for _, entry := range config.Docker.BuildArgs {
			if entry.Secret && entry.Value != "" {
				t.Fatal("un build arg segreto finirebbe nello stato persistito")
			}
		}
	}
}

func TestMakeTargetRunsEndToEnd(t *testing.T) {
	if _, err := exec.LookPath("make"); err != nil {
		t.Skip("make non installato")
	}
	root := t.TempDir()
	makefile := "greet:\n\t@echo hello-$(NAME)\n"
	if err := os.WriteFile(filepath.Join(root, "Makefile"), []byte(makefile), 0o644); err != nil {
		t.Fatal(err)
	}
	events := make(chan EventEnvelope, 256)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartRun(RunRequest{SessionID: session.ID, Kind: "make", ProgramArguments: []string{"greet"}}); err == nil {
		t.Fatal("make avviato senza autorizzazione del progetto")
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	saved, err := service.SaveRunConfiguration(string(session.ID), RunConfiguration{
		Name: "greet", Kind: RunKindMake, ProgramArguments: []string{"greet"},
		Environment: []EnvironmentEntry{{Key: "NAME", Value: "adomnia", Secret: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartConfiguredRun(string(session.ID), saved.ID, nil); err == nil {
		t.Fatal("avvio senza il valore segreto accettato")
	}
	execution, err := service.StartConfiguredRun(string(session.ID), saved.ID, map[string]string{"NAME": "adomnia"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(execution.Command, "adomnia") {
		t.Fatalf("il segreto compare nel comando: %s", execution.Command)
	}
	waitServiceEvent(t, events, func(event EventEnvelope) bool {
		output, ok := event.Payload.(ProcessOutput)
		return ok && output.RunID == execution.ID && strings.Contains(output.Text, "hello-adomnia")
	})
	finished := waitServiceEvent(t, events, func(event EventEnvelope) bool {
		next, ok := event.Payload.(Execution)
		return event.Type == "run.finished" && ok && next.ID == execution.ID
	}).Payload.(Execution)
	if finished.Status != "exited" {
		t.Fatalf("make terminato con stato %q", finished.Status)
	}
}

func TestDockerBuildEndToEnd(t *testing.T) {
	if _, err := resolveDocker(); err != nil {
		t.Skip(err.Error())
	}
	root := t.TempDir()
	files := map[string]string{"Dockerfile": "FROM scratch AS final\nARG TOKEN\nCOPY hello.txt /\n", "hello.txt": "hi\n"}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	events := make(chan EventEnvelope, 1024)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	execution, err := service.StartRun(RunRequest{
		SessionID: session.ID, Kind: "docker-build", Secrets: []string{"TOKEN"},
		Docker: DockerOptions{Tag: "adomnia-goide-test:dev", Stage: "final", BuildArgs: []EnvironmentEntry{{Key: "TOKEN", Value: "hidden", Secret: true}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(execution.Command, "hidden") {
		t.Fatalf("il segreto compare nel comando: %s", execution.Command)
	}
	finished := waitServiceEvent(t, events, func(event EventEnvelope) bool {
		next, ok := event.Payload.(Execution)
		return event.Type == "run.finished" && ok && next.ID == execution.ID
	}).Payload.(Execution)
	if finished.Status != "exited" {
		t.Fatalf("docker build terminato con stato %q", finished.Status)
	}
}
