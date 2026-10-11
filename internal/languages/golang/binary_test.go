package golang

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestBinaryInspection(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"go.mod":          "module example.com/bin\n\ngo 1.22\n",
		"main.go":         "package main\n\nimport (\n\t_ \"embed\"\n\t\"fmt\"\n)\n\n//go:embed assets/logo.txt\nvar logo string\n\nfunc main() { fmt.Println(logo) }\n",
		"assets/logo.txt": "0123456789",
	}
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	exe := filepath.Join(root, "app.exe")
	build := exec.Command("go", "build", "-o", exe, ".")
	build.Dir = root
	if output, err := build.CombinedOutput(); err != nil {
		t.Skipf("go build unavailable: %v %s", err, output)
	}
	report, err := ReadBinaryInfo(exe)
	if err != nil || report.Main != "example.com/bin" || report.GoVersion == "" || report.Settings["GOOS"] == "" || report.Size <= 0 {
		t.Fatalf("info: %+v %v", report, err)
	}
	nm := exec.Command("go", "tool", "nm", "-size", "-sort", "size", exe)
	output, err := nm.Output()
	if err != nil {
		t.Skipf("go tool nm: %v", err)
	}
	ParseNM(string(output), &report)
	packages := map[string]int64{}
	for _, item := range report.Packages {
		packages[item.Name] = item.Size
	}
	if packages["runtime"] == 0 || packages["fmt"] == 0 || packages["main"] == 0 || len(report.Symbols) == 0 {
		t.Fatalf("packages: %v", packages)
	}
	if embedded := EmbeddedFiles(root); len(embedded) != 1 || embedded[0].Name != "assets/logo.txt" || embedded[0].Size != 10 {
		t.Fatalf("embedded: %+v", embedded)
	}
	if symbolPackage("example.com/x/pkg.(*T).M") != "example.com/x/pkg" || symbolPackage("type:*") != "(runtime data)" {
		t.Fatal("symbolPackage")
	}
}
