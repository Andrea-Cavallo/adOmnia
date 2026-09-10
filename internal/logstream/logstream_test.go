package logstream

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func waitForLines(t *testing.T, session *Session, cursor int64, want int) PollResult {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var collected []string
	for time.Now().Before(deadline) {
		result := session.Poll(cursor)
		collected = append(collected, result.Lines...)
		cursor = result.Cursor
		if len(collected) >= want {
			return PollResult{Lines: collected, Cursor: cursor, Running: result.Running, Error: result.Error}
		}
		time.Sleep(60 * time.Millisecond)
	}
	t.Fatalf("expected %d lines, got %d (%v)", want, len(collected), collected)
	return PollResult{}
}

func TestTailFileFollowsAppendsAndResumesWithoutRepeats(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.log")
	if err := os.WriteFile(path, []byte("first\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	session, err := Start(Config{Kind: KindFile, Path: path, FromStart: true})
	if err != nil {
		t.Fatal(err)
	}
	defer Close(session.ID)

	initial := waitForLines(t, session, -1, 1)
	if initial.Lines[0] != "first" {
		t.Fatalf("unexpected first line %q", initial.Lines[0])
	}

	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("second\n"); err != nil {
		t.Fatal(err)
	}
	file.Close()

	appended := waitForLines(t, session, initial.Cursor, 1)
	if appended.Lines[0] != "second" {
		t.Fatalf("unexpected appended line %q", appended.Lines[0])
	}

	// Stop, append while stopped, resume: the offset must avoid re-reading.
	session.stop()
	file, err = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("third\n"); err != nil {
		t.Fatal(err)
	}
	file.Close()
	session.start()

	resumed := waitForLines(t, session, appended.Cursor, 1)
	if len(resumed.Lines) != 1 || resumed.Lines[0] != "third" {
		t.Fatalf("resume produced %v, expected only the new line", resumed.Lines)
	}
}

func TestTailFileRestartsAfterRotation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rotated.log")
	if err := os.WriteFile(path, []byte("before rotation\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	session, err := Start(Config{Kind: KindFile, Path: path, FromStart: true})
	if err != nil {
		t.Fatal(err)
	}
	defer Close(session.ID)
	first := waitForLines(t, session, -1, 1)

	// Rotation: the file is replaced by a shorter one.
	if err := os.WriteFile(path, []byte("after\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rotated := waitForLines(t, session, first.Cursor, 1)
	if rotated.Lines[0] != "after" {
		t.Fatalf("expected the rotated file to be re-read, got %v", rotated.Lines)
	}
}

func TestBufferKeepsTheNewestLines(t *testing.T) {
	session := &Session{Config: Config{Kind: KindFile, BufferLines: 3}}
	for _, line := range []string{"1", "2", "3", "4", "5"} {
		session.append(line)
	}
	result := session.Poll(-1)
	if len(result.Lines) != 3 || result.Lines[0] != "3" {
		t.Fatalf("expected the newest three lines, got %v", result.Lines)
	}
	if result.Dropped != 2 {
		t.Fatalf("expected 2 dropped lines, got %d", result.Dropped)
	}
	if missed := session.Poll(0); !missed.Missed {
		t.Fatal("a cursor pointing at an evicted line must report Missed")
	}
}

func TestStopEndsTheSession(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stop.log")
	if err := os.WriteFile(path, []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	session, err := Start(Config{Kind: KindFile, Path: path, FromStart: true})
	if err != nil {
		t.Fatal(err)
	}
	session.stop()
	time.Sleep(50 * time.Millisecond)
	if session.Poll(-1).Running {
		t.Fatal("a stopped session must not report itself as running")
	}
	Close(session.ID)
	if lookup(session.ID) != nil {
		t.Fatal("a closed session must be forgotten")
	}
}

func TestContainerArgsAreExplicit(t *testing.T) {
	name, args, err := containerArgs(Config{Kind: KindOc, Pod: "api-1", Namespace: "prod", Container: "app", Context: "cluster-a", Since: 60})
	if err != nil || name != "oc" {
		t.Fatalf("unexpected command %q (%v)", name, err)
	}
	joined := ""
	for _, arg := range args {
		joined += arg + " "
	}
	for _, expected := range []string{"logs", "-f", "api-1", "-n prod", "-c app", "--context cluster-a", "--since=60s"} {
		if !contains(joined, expected) {
			t.Fatalf("missing %q in %q", expected, joined)
		}
	}
	if _, _, err := containerArgs(Config{Kind: KindDocker}); err == nil {
		t.Fatal("a docker source without a container must be refused")
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0)
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
