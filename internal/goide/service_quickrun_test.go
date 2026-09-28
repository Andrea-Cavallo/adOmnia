package goide

import (
	"runtime"
	"strings"
	"testing"
	"time"
)

func runAndWait(t *testing.T, service *Service, recorder *eventRecorder, request RunRequest) (Execution, string) {
	t.Helper()
	execution, err := service.StartRun(request)
	if err != nil {
		t.Fatalf("%s: %v", request.Kind, err)
	}
	finished := recorder.waitFor(t, 90*time.Second, func(event EventEnvelope) bool {
		done, ok := event.Payload.(Execution)
		return ok && event.Type == "run.finished" && done.ID == execution.ID
	}).Payload.(Execution)
	var output strings.Builder
	for _, event := range recorder.all() {
		if chunk, ok := event.Payload.(ProcessOutput); ok && chunk.RunID == execution.ID {
			output.WriteString(chunk.Text)
		}
	}
	return finished, output.String()
}

func TestQuickCommandsVetTestAndCompiledBinary(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/quick\n\ngo 1.22\n")
	writeFixtureFile(t, project, "main.go", "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"hello from binary\") }\n")
	writeFixtureFile(t, project, "bad/bad.go", "package bad\n\nimport \"fmt\"\n\nfunc Bad() { fmt.Printf(\"%d\\n\", \"text\") }\n")
	writeFixtureFile(t, project, "calc/calc_test.go", "package calc\n\nimport \"testing\"\n\nfunc TestSum(t *testing.T) { if 1+1 != 2 { t.Fatal() } }\n")

	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}

	vetted, output := runAndWait(t, service, recorder, RunRequest{SessionID: session.ID, Kind: "vet", Target: "./bad"})
	if vetted.Status != "failed" || !strings.Contains(output, "Printf") || !strings.HasPrefix(vetted.Command, "go vet") {
		t.Fatalf("go vet non ha segnalato il problema: %+v %q", vetted, output)
	}

	binaryName := "bin/app"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	built, _ := runAndWait(t, service, recorder, RunRequest{SessionID: session.ID, Kind: "build", Target: ".", GoArguments: []string{"-o", binaryName}})
	if built.Status != "exited" {
		t.Fatalf("build fallita: %+v", built)
	}

	binaryConfig, err := service.SaveRunConfiguration(string(session.ID), RunConfiguration{Name: "binary", Kind: RunKindBinary, BinaryPath: binaryName})
	if err != nil {
		t.Fatal(err)
	}
	request, err := service.buildRunRequest(session, binaryConfig, nil)
	if err != nil {
		t.Fatal(err)
	}
	ran, output := runAndWait(t, service, recorder, request)
	if ran.Status != "exited" || !strings.Contains(output, "hello from binary") {
		t.Fatalf("binario compilato non eseguito: %+v %q", ran, output)
	}

	testConfig, err := service.SaveRunConfiguration(string(session.ID), RunConfiguration{Name: "calc tests", Kind: RunKindTest, Target: "./calc", ProgramArguments: []string{"-v"}})
	if err != nil {
		t.Fatal(err)
	}
	request, err = service.buildRunRequest(session, testConfig, nil)
	if err != nil {
		t.Fatal(err)
	}
	tested, output := runAndWait(t, service, recorder, request)
	if tested.Status != "exited" || !strings.Contains(output, "--- PASS: TestSum") {
		t.Fatalf("configurazione di test non eseguita: %+v %q", tested, output)
	}

	if _, err := service.StartRun(RunRequest{SessionID: session.ID, Kind: "binary", Target: "../outside"}); err == nil {
		t.Fatal("binario esterno al progetto accettato")
	}
	if _, err := service.StartRun(RunRequest{SessionID: session.ID, Kind: "binary", Target: "bin/missing"}); err == nil {
		t.Fatal("binario inesistente accettato")
	}
	if _, err := service.StartRun(RunRequest{SessionID: session.ID, Kind: "rm"}); err == nil {
		t.Fatal("tipo di esecuzione arbitrario accettato")
	}
}
