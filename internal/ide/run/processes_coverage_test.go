package run

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

const helperProcessEnv = "ADOMNIA_TEST_HELPER"

// TestHelperProcess fa rieseguire il binario di test come processo figlio: i
// test del manager non dipendono da comandi di sistema, quindi girano uguali su
// Windows e Linux.
func TestHelperProcess(t *testing.T) {
	mode := os.Getenv(helperProcessEnv)
	if mode == "" {
		return
	}
	switch mode {
	case "echo":
		fmt.Fprintln(os.Stdout, "stdout-line")
		fmt.Fprintln(os.Stderr, "stderr-line")
	case "fail":
		os.Exit(3)
	case "stdin":
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		fmt.Fprintf(os.Stdout, "got:%s\n", strings.TrimSpace(line))
	case "rich":
		fmt.Fprintln(os.Stdout, `{"level":"error","text":"boom"}`)
		fmt.Fprintln(os.Stderr, "warn: something")
	case "wait":
		for {
			time.Sleep(time.Second)
		}
	}
	os.Exit(0)
}

type recordedEvents struct {
	mu       sync.Mutex
	kinds    []string
	output   []ProcessOutput
	finished chan Execution
}

func newRecordedEvents() *recordedEvents {
	return &recordedEvents{finished: make(chan Execution, 4)}
}

func (r *recordedEvents) sink(kind string, execution Execution, payload any) {
	r.mu.Lock()
	r.kinds = append(r.kinds, kind)
	if output, ok := payload.(ProcessOutput); ok {
		r.output = append(r.output, output)
	}
	r.mu.Unlock()
	if kind == "run.finished" {
		select {
		case r.finished <- execution:
		default:
		}
	}
}

func (r *recordedEvents) text(runID RunID, stream string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var builder strings.Builder
	for _, output := range r.output {
		if output.RunID == runID && output.Stream == stream {
			builder.WriteString(output.Text)
		}
	}
	return builder.String()
}

func (r *recordedEvents) hasKind(kind string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, recorded := range r.kinds {
		if recorded == kind {
			return true
		}
	}
	return false
}

func (r *recordedEvents) waitFinished(t *testing.T) Execution {
	t.Helper()
	select {
	case execution := <-r.finished:
		return execution
	case <-time.After(30 * time.Second):
		t.Fatal("run.finished not received")
		return Execution{}
	}
}

func newManager(t *testing.T) (*ProcessManager, *recordedEvents) {
	t.Helper()
	manager := NewProcessManager()
	t.Cleanup(manager.Shutdown)
	recorded := newRecordedEvents()
	manager.SetEventSink(recorded.sink)
	return manager, recorded
}

func helperSpec(t *testing.T, mode string) CommandSpec {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return CommandSpec{
		Kind:             "test",
		Executable:       executable,
		Arguments:        []string{"-test.run=TestHelperProcess"},
		WorkingDirectory: t.TempDir(),
		Environment:      append(os.Environ(), helperProcessEnv+"="+mode),
	}
}

func collectText(t *testing.T, manager *ProcessManager) string {
	t.Helper()
	var builder strings.Builder
	for {
		select {
		case event := <-manager.events:
			output, ok := event.payload.(ProcessOutput)
			if !ok {
				t.Fatalf("unexpected payload %T", event.payload)
			}
			builder.WriteString(output.Text)
		default:
			return builder.String()
		}
	}
}

func TestStartCapturesOutputAndFinishes(t *testing.T) {
	manager, recorded := newManager(t)
	spec := helperSpec(t, "echo")
	spec.SessionID = "session-1"
	spec.DisplayCommand = "helper echo"

	execution, err := manager.Start(spec)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(execution.ID), "run-") || execution.Status != "running" || execution.PID == 0 {
		t.Fatalf("unexpected execution: %+v", execution)
	}
	if manager.ActiveCount() != 1 || !manager.HasActive() || !manager.HasActiveSession("session-1") {
		t.Fatalf("the run should be active: %+v", execution)
	}

	if !manager.WaitStopped(execution.ID, 30*time.Second) {
		t.Fatal("the run did not finish")
	}
	finished := recorded.waitFinished(t)
	if finished.Status != "exited" || finished.ExitCode == nil || *finished.ExitCode != 0 {
		t.Fatalf("unexpected result: %+v", finished)
	}
	if finished.FinishedAt == nil || finished.Command != "helper echo" || finished.SessionID != "session-1" {
		t.Fatalf("incomplete snapshot: %+v", finished)
	}
	if stdout := recorded.text(execution.ID, "stdout"); !strings.Contains(stdout, "stdout-line") {
		t.Fatalf("stdout not captured: %q", stdout)
	}
	if stderr := recorded.text(execution.ID, "stderr"); !strings.Contains(stderr, "stderr-line") {
		t.Fatalf("stderr not captured: %q", stderr)
	}
	if !recorded.hasKind("run.started") {
		t.Fatal("run.started was not published")
	}
	recorded.mu.Lock()
	last := recorded.kinds[len(recorded.kinds)-1]
	recorded.mu.Unlock()
	if last != "run.finished" {
		t.Fatalf("last event = %q, want run.finished", last)
	}
	if manager.ActiveCount() != 0 || manager.HasActive() {
		t.Fatal("the finished run is still active")
	}
}

func TestStartRejectsMissingExecutable(t *testing.T) {
	manager, _ := newManager(t)
	for _, executable := range []string{"", "   "} {
		if _, err := manager.Start(CommandSpec{Executable: executable}); err == nil || !strings.Contains(err.Error(), "eseguibile mancante") {
			t.Fatalf("Start(%q) err = %v", executable, err)
		}
	}
}

func TestStartReportsLaunchFailure(t *testing.T) {
	manager, _ := newManager(t)
	missing := filepath.Join(t.TempDir(), "does-not-exist")
	_, err := manager.Start(CommandSpec{Executable: missing, WorkingDirectory: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "avvio processo fallito") {
		t.Fatalf("err = %v", err)
	}
	if manager.HasActive() {
		t.Fatal("a failed launch must not stay active")
	}
}

func TestStartRejectsBeyondConcurrencyLimit(t *testing.T) {
	manager := &ProcessManager{processes: make(map[RunID]*managedProcess, MaxConcurrentRuns)}
	for index := range MaxConcurrentRuns {
		manager.processes[RunID(fmt.Sprintf("run-%d", index))] = &managedProcess{}
	}
	_, err := manager.Start(CommandSpec{Executable: "anything"})
	if err == nil || !strings.Contains(err.Error(), "troppe esecuzioni attive") {
		t.Fatalf("err = %v", err)
	}
}

func TestStartCollectsDiagnosticsAndRewritesConsole(t *testing.T) {
	manager, recorded := newManager(t)
	var tapMu sync.Mutex
	var tapped strings.Builder

	spec := helperSpec(t, "rich")
	spec.OutputTap = func(stream string, data []byte) {
		tapMu.Lock()
		tapped.Write(data)
		tapMu.Unlock()
	}
	spec.Diagnostics = func(line string) (Diagnostic, bool) {
		if strings.HasPrefix(line, "warn:") {
			return Diagnostic{File: "main.go", Line: 7, Severity: 2, Message: line}, true
		}
		return Diagnostic{}, false
	}
	spec.ConsoleLine = func(line string) (string, bool) {
		if strings.HasPrefix(line, "{") {
			return "boom-line", true
		}
		return "", false
	}

	execution, err := manager.Start(spec)
	if err != nil {
		t.Fatal(err)
	}
	finished := recorded.waitFinished(t)
	if len(finished.Diagnostics) != 1 || finished.Diagnostics[0].Message != "warn: something" {
		t.Fatalf("diagnostics = %+v", finished.Diagnostics)
	}
	stdout := recorded.text(execution.ID, "stdout")
	if !strings.Contains(stdout, "boom-line") || strings.Contains(stdout, `"level"`) {
		t.Fatalf("stdout = %q", stdout)
	}
	tapMu.Lock()
	raw := tapped.String()
	tapMu.Unlock()
	if !strings.Contains(raw, `"level":"error"`) || !strings.Contains(raw, "warn: something") {
		t.Fatalf("tap = %q", raw)
	}
}

func TestStartReportsFailedExitCode(t *testing.T) {
	manager, recorded := newManager(t)
	execution, err := manager.Start(helperSpec(t, "fail"))
	if err != nil {
		t.Fatal(err)
	}
	finished := recorded.waitFinished(t)
	if finished.Status != "failed" || finished.ExitCode == nil || *finished.ExitCode != 3 {
		t.Fatalf("unexpected result: %+v", finished)
	}
	if !manager.WaitStopped(execution.ID, 30*time.Second) {
		t.Fatal("the run did not finish")
	}
}

func TestQuietStdoutKeepsOutputOutOfTheEvents(t *testing.T) {
	manager, recorded := newManager(t)
	var tapMu sync.Mutex
	var tapped strings.Builder
	spec := helperSpec(t, "echo")
	spec.QuietStdout = true
	spec.OutputTap = func(stream string, data []byte) {
		tapMu.Lock()
		tapped.WriteString(stream + ":" + string(data))
		tapMu.Unlock()
	}

	execution, err := manager.Start(spec)
	if err != nil {
		t.Fatal(err)
	}
	recorded.waitFinished(t)
	if stdout := recorded.text(execution.ID, "stdout"); stdout != "" {
		t.Fatalf("quiet stdout published: %q", stdout)
	}
	if stderr := recorded.text(execution.ID, "stderr"); !strings.Contains(stderr, "stderr-line") {
		t.Fatalf("stderr = %q", stderr)
	}
	tapMu.Lock()
	raw := tapped.String()
	tapMu.Unlock()
	if !strings.Contains(raw, "stdout:stdout-line") {
		t.Fatalf("tap did not see quiet stdout: %q", raw)
	}
}

func TestWriteStdinFeedsTheProcess(t *testing.T) {
	manager, recorded := newManager(t)
	execution, err := manager.Start(helperSpec(t, "stdin"))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.WriteStdin(execution.ID, "hello\n"); err != nil {
		t.Fatal(err)
	}
	finished := recorded.waitFinished(t)
	if finished.ExitCode == nil || *finished.ExitCode != 0 {
		t.Fatalf("unexpected result: %+v", finished)
	}
	if stdout := recorded.text(execution.ID, "stdout"); !strings.Contains(stdout, "got:hello") {
		t.Fatalf("stdout = %q", stdout)
	}
	if err := manager.WriteStdin(execution.ID, "again\n"); err == nil || !strings.Contains(err.Error(), "not active") {
		t.Fatalf("err = %v", err)
	}
	tooLarge := strings.Repeat("a", maxStdinBytes+1)
	if err := manager.WriteStdin("run-unknown", tooLarge); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("err = %v", err)
	}
}

func TestStopTerminatesTheProcessTree(t *testing.T) {
	manager, recorded := newManager(t)
	onStop := make(chan struct{}, 1)
	onExit := make(chan Execution, 1)

	spec := helperSpec(t, "wait")
	spec.OnStop = func() { onStop <- struct{}{} }
	spec.OnExit = func(execution Execution) { onExit <- execution }

	execution, err := manager.Start(spec)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Stop(execution.ID); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if !manager.WaitStopped(execution.ID, 30*time.Second) {
		t.Fatal("the run did not stop")
	}
	select {
	case <-onStop:
	case <-time.After(10 * time.Second):
		t.Fatal("OnStop was not called")
	}
	select {
	case exited := <-onExit:
		if exited.Status != "stopped" {
			t.Fatalf("OnExit status = %q", exited.Status)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("OnExit was not called")
	}
	finished := recorded.waitFinished(t)
	if finished.Status != "stopped" {
		t.Fatalf("status = %q, want stopped", finished.Status)
	}
	if err := manager.Stop(execution.ID); err != nil {
		t.Fatalf("second Stop: %v", err)
	}
	if err := manager.Stop("run-unknown"); err != nil {
		t.Fatalf("Stop on unknown run: %v", err)
	}
	if err := manager.Stop(execution.ID); err != nil {
		t.Fatalf("Stop on finished run: %v", err)
	}
}

func TestWaitStoppedOnUnknownAndRunningRuns(t *testing.T) {
	manager, _ := newManager(t)
	if !manager.WaitStopped("run-unknown", time.Millisecond) {
		t.Fatal("an unknown run is already stopped")
	}
	execution, err := manager.Start(helperSpec(t, "wait"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := manager.Stop(execution.ID); err != nil {
			t.Errorf("Stop: %v", err)
		}
	}()
	if manager.WaitStopped(execution.ID, 25*time.Millisecond) {
		t.Fatal("a running process cannot be reported as stopped")
	}
}

func TestNoticePublishesInformationalLine(t *testing.T) {
	manager, _ := newManager(t)
	received := make(chan ProcessOutput, 1)
	manager.SetEventSink(func(kind string, _ Execution, payload any) {
		if kind == "run.output" {
			if output, ok := payload.(ProcessOutput); ok {
				received <- output
			}
		}
	})
	manager.Notice(Execution{ID: "run-notice"}, "compilazione avviata")
	select {
	case output := <-received:
		if output.RunID != "run-notice" || output.Stream != "stderr" || output.Text != "\n[adOmnia] compilazione avviata\n" {
			t.Fatalf("unexpected notice: %+v", output)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("notice was not published")
	}
}

func TestListAndExecutionSnapshots(t *testing.T) {
	manager, recorded := newManager(t)
	firstSpec := helperSpec(t, "echo")
	firstSpec.SessionID = "session-a"
	secondSpec := helperSpec(t, "echo")
	secondSpec.SessionID = "session-b"

	first, err := manager.Start(firstSpec)
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Start(secondSpec)
	if err != nil {
		t.Fatal(err)
	}
	recorded.waitFinished(t)
	recorded.waitFinished(t)

	all := manager.List("")
	if len(all) != 2 || !all[0].StartedAt.Before(all[1].StartedAt) {
		t.Fatalf("List(\"\") = %+v", all)
	}
	if only := manager.List("session-a"); len(only) != 1 || only[0].ID != first.ID {
		t.Fatalf("List(session-a) = %+v", only)
	}
	if none := manager.List("session-zzz"); len(none) != 0 {
		t.Fatalf("List(session-zzz) = %+v", none)
	}
	if snapshot, ok := manager.Execution(second.ID); !ok || snapshot.Status != "exited" {
		t.Fatalf("Execution = %+v, %v", snapshot, ok)
	}
	if _, ok := manager.Execution("run-unknown"); ok {
		t.Fatal("unknown execution reported as present")
	}
}

func TestStopSessionOnlyStopsThatSession(t *testing.T) {
	manager, _ := newManager(t)
	firstSpec := helperSpec(t, "wait")
	firstSpec.SessionID = "session-a"
	secondSpec := helperSpec(t, "wait")
	secondSpec.SessionID = "session-b"

	first, err := manager.Start(firstSpec)
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Start(secondSpec)
	if err != nil {
		t.Fatal(err)
	}
	manager.StopSession("session-a")
	if !manager.WaitStopped(first.ID, 30*time.Second) {
		t.Fatal("session-a did not stop")
	}
	if manager.HasActiveSession("session-a") {
		t.Fatal("session-a still active")
	}
	if !manager.HasActiveSession("session-b") || manager.ActiveCount() != 1 {
		t.Fatalf("session-b should still run: active=%d", manager.ActiveCount())
	}
	if err := manager.Stop(second.ID); err != nil {
		t.Fatal(err)
	}
	if !manager.WaitStopped(second.ID, 30*time.Second) {
		t.Fatal("session-b did not stop")
	}
	manager.StopSession("session-missing")
}

func TestShutdownStopsEverythingAndIsIdempotent(t *testing.T) {
	manager := NewProcessManager()
	execution, err := manager.Start(helperSpec(t, "wait"))
	if err != nil {
		t.Fatal(err)
	}
	manager.Shutdown()
	if !manager.WaitStopped(execution.ID, 30*time.Second) {
		t.Fatal("Shutdown did not stop the run")
	}
	if manager.ActiveCount() != 0 {
		t.Fatalf("active = %d", manager.ActiveCount())
	}
	manager.Shutdown()
}

func TestPruneHistoryDropsOnlyInactiveOldest(t *testing.T) {
	history := func(count int) map[RunID]Execution {
		result := make(map[RunID]Execution, count)
		for index := range count {
			id := RunID(fmt.Sprintf("run-%03d", index))
			result[id] = Execution{ID: id, StartedAt: time.Unix(int64(index), 0).UTC()}
		}
		return result
	}

	t.Run("trims to the limit keeping the newest", func(t *testing.T) {
		manager := &ProcessManager{processes: map[RunID]*managedProcess{}, history: history(105)}
		manager.pruneHistoryLocked()
		if len(manager.history) != maxExecutionHistory {
			t.Fatalf("history = %d", len(manager.history))
		}
		if _, ok := manager.history["run-004"]; ok {
			t.Fatal("run-004 should have been pruned")
		}
		if _, ok := manager.history["run-005"]; !ok {
			t.Fatal("run-005 should have been kept")
		}
	})

	t.Run("never prunes an active run", func(t *testing.T) {
		processes := map[RunID]*managedProcess{}
		for index := range 105 {
			processes[RunID(fmt.Sprintf("run-%03d", index))] = &managedProcess{}
		}
		manager := &ProcessManager{processes: processes, history: history(105)}
		manager.pruneHistoryLocked()
		if len(manager.history) != 105 {
			t.Fatalf("history = %d, want 105", len(manager.history))
		}
	})

	t.Run("stops as soon as nothing is prunable", func(t *testing.T) {
		processes := map[RunID]*managedProcess{}
		for index := range 3 {
			processes[RunID(fmt.Sprintf("run-%03d", index))] = &managedProcess{}
		}
		manager := &ProcessManager{processes: processes, history: history(103)}
		manager.pruneHistoryLocked()
		if len(manager.history) != maxExecutionHistory {
			t.Fatalf("history = %d", len(manager.history))
		}
		for index := range 3 {
			if _, ok := manager.history[RunID(fmt.Sprintf("run-%03d", index))]; !ok {
				t.Fatalf("active run-%03d was pruned", index)
			}
		}
	})
}

func TestNewIDHasPrefixAndRandomSuffix(t *testing.T) {
	id := newID("run")
	if !strings.HasPrefix(id, "run-") {
		t.Fatalf("id = %q", id)
	}
	suffix := strings.TrimPrefix(id, "run-")
	if len(suffix) != 24 {
		t.Fatalf("suffix = %q", suffix)
	}
	if _, err := hex.DecodeString(suffix); err != nil {
		t.Fatalf("suffix is not hex: %v", err)
	}
	if other := newID("run"); other == id {
		t.Fatal("two ids are equal")
	}
}

func TestCompleteUTF8Prefix(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want int
	}{
		{"empty", nil, 0},
		{"ascii", []byte("hello"), 5},
		{"complete multibyte", []byte("héllo"), 6},
		{"only a leading byte of a two-byte rune", []byte{0xC3}, 0},
		{"truncated two-byte rune", []byte("caf\xc3"), 3},
		{"truncated three-byte rune", []byte("x\xE2\x82"), 1},
		{"truncated four-byte rune", []byte("ab\xF0\x9F"), 2},
		{"complete emoji", []byte("😀"), 4},
		{"invalid byte counts as complete", []byte("ab\xff"), 3},
		{"trailing continuation bytes", []byte("ab\x80\x80"), 4},
		{"only continuation bytes", []byte{0x80}, 1},
		{"four continuation bytes", []byte{0x80, 0x80, 0x80, 0x80}, 4},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := completeUTF8Prefix(testCase.data); got != testCase.want {
				t.Fatalf("completeUTF8Prefix(%q) = %d, want %d", testCase.data, got, testCase.want)
			}
		})
	}
}

func newTestWriter(manager *ProcessManager, process *managedProcess, stream string) *outputWriter {
	return &outputWriter{
		manager:   manager,
		process:   process,
		execution: Execution{ID: "run-writer"},
		stream:    stream,
	}
}

func TestOutputWriterJoinsASplitRuneAcrossWrites(t *testing.T) {
	manager := &ProcessManager{events: make(chan processEvent, 8), stop: make(chan struct{})}
	writer := newTestWriter(manager, &managedProcess{}, "stdout")

	if count, err := writer.Write([]byte("caf\xc3")); err != nil || count != 4 {
		t.Fatalf("Write = %d, %v", count, err)
	}
	if count, err := writer.Write([]byte("\xa9")); err != nil || count != 1 {
		t.Fatalf("Write = %d, %v", count, err)
	}
	writer.flush()

	text := collectText(t, manager)
	if text != "café" {
		t.Fatalf("text = %q", text)
	}
	if !utf8.ValidString(text) {
		t.Fatalf("invalid utf-8: %q", text)
	}
}

func TestOutputWriterFlushRewritesTheTrailingConsoleLine(t *testing.T) {
	t.Run("handled line gets a newline", func(t *testing.T) {
		manager := &ProcessManager{events: make(chan processEvent, 8), stop: make(chan struct{})}
		process := &managedProcess{console: func(line string) (string, bool) {
			return "rendered:" + line, true
		}}
		writer := newTestWriter(manager, process, "stdout")

		if _, err := writer.Write([]byte(`{"a":1}`)); err != nil {
			t.Fatal(err)
		}
		if text := collectText(t, manager); text != "" {
			t.Fatalf("an incomplete JSON line must wait: %q", text)
		}
		writer.flush()
		if text := collectText(t, manager); text != "rendered:{\"a\":1}\n" {
			t.Fatalf("text = %q", text)
		}
	})

	t.Run("dropped line publishes nothing", func(t *testing.T) {
		manager := &ProcessManager{events: make(chan processEvent, 8), stop: make(chan struct{})}
		process := &managedProcess{console: func(string) (string, bool) { return "", true }}
		writer := newTestWriter(manager, process, "stdout")

		if _, err := writer.Write([]byte(`{"a":1}`)); err != nil {
			t.Fatal(err)
		}
		writer.flush()
		if text := collectText(t, manager); text != "" {
			t.Fatalf("text = %q", text)
		}
	})

	t.Run("unhandled line passes unchanged", func(t *testing.T) {
		manager := &ProcessManager{events: make(chan processEvent, 8), stop: make(chan struct{})}
		process := &managedProcess{console: func(string) (string, bool) { return "", false }}
		writer := newTestWriter(manager, process, "stdout")

		if _, err := writer.Write([]byte(`{"a":1}`)); err != nil {
			t.Fatal(err)
		}
		writer.flush()
		if text := collectText(t, manager); text != `{"a":1}` {
			t.Fatalf("text = %q", text)
		}
	})
}

func TestOutputWriterPublishFlagsTruncationWhenTheQueueIsSaturated(t *testing.T) {
	manager := &ProcessManager{events: make(chan processEvent, 1), stop: make(chan struct{})}
	close(manager.stop)
	manager.events <- processEvent{eventType: "filler"}
	process := &managedProcess{}
	writer := newTestWriter(manager, process, "stdout")

	writer.publish([]byte("payload"))
	if !process.truncated.Load() {
		t.Fatal("a dropped output must be recorded as truncated")
	}
	if len(manager.events) != 1 {
		t.Fatalf("queue = %d, want the filler only", len(manager.events))
	}
}

func TestFlushPendingPublishesTheFloodNoticeOnce(t *testing.T) {
	manager := &ProcessManager{events: make(chan processEvent, 8), stop: make(chan struct{})}
	writer := newTestWriter(manager, &managedProcess{}, "stdout")

	writer.pending = []byte("latest")
	writer.dropped = true
	writer.flushPending()
	first := collectText(t, manager)
	if !strings.Contains(first, "latest") || !strings.Contains(first, "Output troppo veloce") {
		t.Fatalf("first flush = %q", first)
	}

	writer.pending = []byte("more")
	writer.dropped = true
	writer.flushPending()
	second := collectText(t, manager)
	if !strings.Contains(second, "more") || strings.Contains(second, "Output troppo veloce") {
		t.Fatalf("second flush = %q", second)
	}
}

func TestPublishNonImportantDropsWhenTheQueueIsFull(t *testing.T) {
	manager := &ProcessManager{events: make(chan processEvent, 1), stop: make(chan struct{})}
	if !manager.publish(processEvent{eventType: "first"}, false) {
		t.Fatal("the first event fits the queue")
	}
	if manager.publish(processEvent{eventType: "second"}, false) {
		t.Fatal("a full queue must drop the plain event")
	}
	<-manager.events
	if !manager.publish(processEvent{eventType: "third"}, false) {
		t.Fatal("room was freed")
	}
}

func TestPublishImportantWaitsForRoomAndGivesUpOnShutdown(t *testing.T) {
	t.Run("delivered when someone drained the queue", func(t *testing.T) {
		manager := &ProcessManager{events: make(chan processEvent), stop: make(chan struct{})}
		received := make(chan processEvent, 1)
		go func() { received <- <-manager.events }()
		if !manager.publish(processEvent{eventType: "run.started"}, true) {
			t.Fatal("the important event must be delivered")
		}
		if event := <-received; event.eventType != "run.started" {
			t.Fatalf("event = %q", event.eventType)
		}
	})

	t.Run("abandoned after shutdown", func(t *testing.T) {
		manager := &ProcessManager{events: make(chan processEvent), stop: make(chan struct{})}
		close(manager.stop)
		if manager.publish(processEvent{eventType: "run.finished"}, true) {
			t.Fatal("a closed manager must not accept events")
		}
	})

	t.Run("times out", func(t *testing.T) {
		manager := &ProcessManager{events: make(chan processEvent), stop: make(chan struct{})}
		if manager.publish(processEvent{eventType: "run.finished"}, true) {
			t.Fatal("nobody is draining the queue")
		}
	})
}

func TestStopSkipsTerminationForAnAlreadyExitedProcess(t *testing.T) {
	manager := &ProcessManager{processes: map[RunID]*managedProcess{}}
	exited := &managedProcess{stdin: nopWriteCloser{}, done: make(chan struct{})}
	exited.exited.Store(true)
	manager.processes["run-exited"] = exited
	if err := manager.Stop("run-exited"); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	var stopped *managedProcess
	stopped = &managedProcess{stdin: nopWriteCloser{}, done: make(chan struct{})}
	stopped.onStop = func() { stopped.exited.Store(true) }
	manager.processes["run-stopped-during-hook"] = stopped
	if err := manager.Stop("run-stopped-during-hook"); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if !stopped.stopping.Load() {
		t.Fatal("Stop must mark the run as stopping")
	}
}

// nopWriteCloser sostituisce la pipe di stdin nei processi costruiti a mano.
type nopWriteCloser struct{}

func (nopWriteCloser) Write(p []byte) (int, error) { return len(p), nil }
func (nopWriteCloser) Close() error                { return nil }

func TestWriteStdinReportsAClosedPipe(t *testing.T) {
	manager, _ := newManager(t)
	execution, err := manager.Start(helperSpec(t, "wait"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := manager.Stop(execution.ID); err != nil {
			t.Errorf("Stop: %v", err)
		}
	})
	process := manager.active(execution.ID)
	if process == nil {
		t.Fatal("the run is not active")
	}
	if err := process.stdin.Close(); err != nil {
		t.Fatal(err)
	}
	if err := manager.WriteStdin(execution.ID, "text"); err == nil || !strings.Contains(err.Error(), "invio input fallito") {
		t.Fatalf("err = %v", err)
	}
}

func TestEnqueueTrimsToARuneBoundaryWhenDroppingOutput(t *testing.T) {
	writer := &outputWriter{}
	writer.pending = append(
		bytes.Repeat([]byte{0x80}, 100),
		bytes.Repeat([]byte("a"), maxOutputBytesPerFlush-100)...,
	)
	writer.enqueue(make([]byte, 50))
	if writer.timer != nil {
		writer.timer.Stop()
		writer.timer = nil
	}
	if !writer.dropped {
		t.Fatal("the excess must be recorded as dropped")
	}
	if len(writer.pending) != maxOutputBytesPerFlush-50 || writer.pending[0] != 'a' {
		t.Fatalf("pending = %d, first = %q", len(writer.pending), writer.pending[0])
	}
}

func TestDispatchEventsDeliversAndStops(t *testing.T) {
	manager := &ProcessManager{events: make(chan processEvent, 4), stop: make(chan struct{})}
	done := make(chan struct{})
	go func() {
		manager.dispatchEvents()
		close(done)
	}()

	// Sink assente: l'evento viene consumato senza panic.
	manager.events <- processEvent{eventType: "run.output"}
	deadline := time.Now().Add(10 * time.Second)
	for len(manager.events) != 0 {
		if time.Now().After(deadline) {
			t.Fatal("the dispatcher did not consume the event")
		}
	}

	received := make(chan processEvent, 1)
	manager.SetEventSink(func(kind string, execution Execution, payload any) {
		received <- processEvent{eventType: kind, execution: execution, payload: payload}
	})
	manager.events <- processEvent{eventType: "run.started", execution: Execution{ID: "run-dispatch"}}
	select {
	case event := <-received:
		if event.eventType != "run.started" || event.execution.ID != "run-dispatch" {
			t.Fatalf("event = %+v", event)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the sink did not receive the event")
	}

	close(manager.stop)
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("dispatchEvents did not stop")
	}
}
