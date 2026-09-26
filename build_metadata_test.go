package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsMetadataTemplatesUseBuildTokens(t *testing.T) {
	infoPath := filepath.Join("build", "windows", "info.template.json")
	info, err := os.ReadFile(infoPath)
	if err != nil {
		t.Fatalf("read %s: %v", infoPath, err)
	}

	if strings.Contains(string(info), "{{") {
		t.Fatalf("%s contains Go template syntax that wails3 generate syso does not render", infoPath)
	}

	rendered := strings.NewReplacer(
		"@@PRODUCT_VERSION@@", "0.9.28",
		"@@RESOURCE_VERSION@@", "0.9.28.0",
	).Replace(string(info))
	var document map[string]any
	if err := json.Unmarshal([]byte(rendered), &document); err != nil {
		t.Fatalf("rendered info resource is not JSON: %v", err)
	}
	if strings.Contains(rendered, "@@") {
		t.Fatal("rendered info resource contains unresolved metadata tokens")
	}

	manifestPath := filepath.Join("build", "windows", "wails.exe.manifest.template")
	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read %s: %v", manifestPath, err)
	}
	if strings.Contains(string(manifest), "{{") || !strings.Contains(string(manifest), "@@RESOURCE_VERSION@@") {
		t.Fatalf("%s must use the resource-version build token", manifestPath)
	}

	taskfile, err := os.ReadFile(filepath.Join("build", "windows", "Taskfile.yml"))
	if err != nil {
		t.Fatalf("read Windows Taskfile: %v", err)
	}
	for _, required := range []string{
		"render-windows-build-metadata.ps1",
		"windows-info-{{.WINDOWS_ARCH}}.json",
		"windows-manifest-{{.WINDOWS_ARCH}}.xml",
	} {
		if !strings.Contains(string(taskfile), required) {
			t.Errorf("Windows Taskfile must render %s before generating the syso", required)
		}
	}
}
