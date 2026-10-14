package docker

import "testing"

func TestContainerHealth(t *testing.T) {
	cases := map[string]string{
		"Up 5 minutes (healthy)":            "healthy",
		"Up 2 seconds (health: starting)":   "starting",
		"Up 1 hour (unhealthy)":             "unhealthy",
		"Up 3 minutes":                      "",
		"Exited (1) 2 minutes ago":          "",
		"Restarting (1) Less than a second": "",
	}
	for status, want := range cases {
		if got := containerHealth(status); got != want {
			t.Errorf("containerHealth(%q) = %q, want %q", status, got, want)
		}
	}
}

func TestLabRestartRejectsForeignProjects(t *testing.T) {
	lab := NewDockerLab()
	for _, name := range []string{"", "postgres", "adomnia-", "adomnia-x; rm -rf /", "../adomnia-x"} {
		if _, err := lab.LabRestart(name, ""); err == nil {
			t.Errorf("LabRestart(%q) accepted a non-lab project", name)
		}
	}
}

func TestEmbeddedLabCommandValidation(t *testing.T) {
	if _, err := validLabCommand("   "); err == nil {
		t.Fatal("empty command accepted")
	}
	if _, err := validLabCommand(string(make([]byte, 4097))); err == nil {
		t.Fatal("oversized command accepted")
	}
	if got, err := validLabCommand("  pwd  "); err != nil || got != "pwd" {
		t.Fatalf("valid command rejected: %q %v", got, err)
	}
}

func TestBoundedOutputStopsRetainingAfterLimit(t *testing.T) {
	output := newBoundedOutput(4)
	if n, err := output.Write([]byte("abcdef")); err != nil || n != 6 {
		t.Fatalf("Write() = %d, %v; want 6, nil", n, err)
	}
	if got := output.String(); got != "abcd\n[output truncated]\n" {
		t.Fatalf("String() = %q", got)
	}
}
