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

func TestShellLauncherPerOS(t *testing.T) {
	name, args, err := shellLauncher("windows", "abc123")
	if err != nil || name != "cmd" || args[len(args)-1] != "sh" || args[len(args)-2] != "abc123" {
		t.Fatalf("windows: %s %v %v", name, args, err)
	}
	if name, _, err := shellLauncher("darwin", "abc123"); err != nil || name != "osascript" {
		t.Fatalf("darwin: %s %v", name, err)
	}
	if _, _, err := shellLauncher("plan9", "abc123"); err == nil {
		t.Fatal("unsupported OS accepted")
	}
}
