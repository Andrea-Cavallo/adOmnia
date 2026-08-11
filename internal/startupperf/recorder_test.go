package startupperf

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRecordAppendsLocalTimingSample(t *testing.T) {
	dir := t.TempDir()
	if err := Record(dir, `{"rendererToFirstStableFrame":42.5}`, map[string]any{"totalMs": 7.8}); err != nil {
		t.Fatalf("record sample: %v", err)
	}

	file, err := os.Open(filepath.Join(dir, Filename))
	if err != nil {
		t.Fatalf("open sample file: %v", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		t.Fatal("expected one JSONL sample")
	}
	var sample Sample
	if err := json.Unmarshal(scanner.Bytes(), &sample); err != nil {
		t.Fatalf("decode sample: %v", err)
	}
	if sample.Frontend["rendererToFirstStableFrame"] != 42.5 || sample.Backend["totalMs"] != 7.8 {
		t.Fatalf("unexpected sample: %#v", sample)
	}
}

func TestRecordRejectsInvalidFrontendJSON(t *testing.T) {
	if err := Record(t.TempDir(), `{`, nil); err == nil {
		t.Fatal("expected invalid JSON error")
	}
}
