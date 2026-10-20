package codestudio

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Exercise the same facade invoked by the folder menu, including authorization and process launch.
func TestMavenFolderRunUsesSelectedModule(t *testing.T) {
	root := t.TempDir()
	module := filepath.Join(root, "module")
	if err := os.MkdirAll(filepath.Join(root, ".mvn", "wrapper"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(module, 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{"pom.xml": "<project/>", "module/pom.xml": "<project/>", ".mvn/wrapper/maven-wrapper.properties": "distributionUrl=unused"}
	wrapper, script := "mvnw", "#!/bin/sh\npwd > maven-folder.txt\nprintf '%s\\n' \"$@\" >> maven-folder.txt\n"
	if runtime.GOOS == "windows" {
		wrapper = "mvnw.cmd"
		script = "@echo off\r\necho %CD%>maven-folder.txt\r\necho %*>>maven-folder.txt\r\n"
	}
	files[wrapper] = script
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(name)), []byte(data), 0700); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	request := RunRequest{SessionID: session.ID, Language: "java", Kind: "maven", Target: ".", WorkingDirectory: "module", ProgramArguments: []string{"clean", "package"}}
	if _, err := service.StartRun(request); err == nil {
		t.Fatal("untrusted project ran a build")
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	execution, err := service.StartRun(request)
	if err != nil {
		t.Fatal(err)
	}
	if !service.processes.WaitStopped(execution.ID, 10*time.Second) {
		t.Fatal("Maven wrapper did not finish")
	}
	data, err := os.ReadFile(filepath.Join(module, "maven-folder.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), module) || !strings.Contains(string(data), "clean") || !strings.Contains(string(data), "package") {
		t.Fatalf("wrong directory/arguments: %s", data)
	}
}
