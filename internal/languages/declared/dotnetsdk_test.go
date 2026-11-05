package declared

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

func writeCSharpFixture(t *testing.T, sdkVersion string) string {
	t.Helper()
	root := t.TempDir()
	if sdkVersion != "" {
		global := `{"sdk":{"version":"` + sdkVersion + `","rollForward":"latestFeature"}}`
		if err := os.WriteFile(filepath.Join(root, "global.json"), []byte(global), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(root, "src", "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "app", "app.csproj"), []byte(`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestDotnetUnitFindsTheSDKRequestedByGlobalJSON(t *testing.T) {
	root := writeCSharpFixture(t, "8.0.204")
	detector := rowAdapter(t, "csharp").(language.ProjectDetector)
	units, err := detector.DetectUnits(context.Background(), root)
	if err != nil || len(units) != 1 {
		t.Fatalf("units = %+v, %v", units, err)
	}
	if units[0].Language != "csharp" || filepath.Base(units[0].Manifest) != "app.csproj" {
		t.Fatalf("unit = %+v", units[0])
	}
	sdk := dotnetSDK(units[0].Root)
	if sdk.Requested != "8.0.204" || sdk.RollForward != "latestFeature" || sdk.GlobalJSON != filepath.Join(root, "global.json") {
		t.Fatalf("sdk = %+v", sdk)
	}
}

func TestDotnetSDKIsFoundFromASubdirectory(t *testing.T) {
	root := writeCSharpFixture(t, "9.0.100")
	if sdk := dotnetSDK(filepath.Join(root, "src", "app")); sdk.Requested != "9.0.100" {
		t.Fatalf("sdk = %+v", sdk)
	}
}

func TestMissingDotnetNamesTheRequestedSDK(t *testing.T) {
	t.Cleanup(func() { lookPath = defaultLookPath })
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	root := writeCSharpFixture(t, "8.0.204")
	runner := rowAdapter(t, "csharp").(language.Runner)
	_, err := runner.CommandSpec(run.Request{Root: root, WorkingDirectory: filepath.Join(root, "src", "app"), Kind: KindDotnet})
	if err == nil || !strings.Contains(err.Error(), "8.0.204") || !strings.Contains(err.Error(), "global.json") {
		t.Fatalf("error = %v", err)
	}
}
