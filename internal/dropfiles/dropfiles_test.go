package dropfiles

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRead(t *testing.T) {
	dir := t.TempDir()
	text := filepath.Join(dir, "spec.YAML")
	bin := filepath.Join(dir, "doc.pdf")
	exe := filepath.Join(dir, "x.exe")
	for path, data := range map[string]string{text: "a: 1", bin: "%PDF", exe: "MZ"} {
		if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := Read([]string{text, " ", bin})
	if err != nil || len(got) != 2 || got[0].Text != "a: 1" || got[1].BytesBase64 != "JVBERg==" {
		t.Fatalf("got %+v, %v", got, err)
	}
	for _, bad := range []string{exe, dir, filepath.Join(dir, "missing.json")} {
		if _, err := Read([]string{bad}); err == nil {
			t.Errorf("%s must be rejected", bad)
		}
	}
}
