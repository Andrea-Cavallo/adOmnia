package milk

import (
	"context"
	jsonv1 "encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadTextFileIsContainedFilteredAndRedacted(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".adomnia"), 0o755); err != nil {
		t.Fatal(err)
	}
	content := "first\npassword = \"super-secret-value\"\nlast\n"
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".adomnia", "aiignore"), []byte("ignored.txt\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "ignored.txt"), []byte("do not send"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(NewSettingsStore(t.TempDir()))
	manager.rootBySession["session"] = root
	handler := &handler{manager: manager}

	result, err := handler.HandleRequest(context.Background(), "fs/read_text_file", jsonv1.RawMessage(fmt.Sprintf(`{"sessionId":"session","path":%q}`, "main.go")))
	if err != nil {
		t.Fatal(err)
	}
	response := result.(map[string]any)
	text := response["content"].(string)
	if strings.Contains(text, "super-secret-value") || !strings.Contains(text, "first\n") {
		t.Fatalf("unexpected redacted content: %q", text)
	}

	for _, request := range []string{
		`{"sessionId":"session","path":"ignored.txt"}`,
		`{"sessionId":"session","path":"../outside.txt"}`,
		`{"sessionId":"missing","path":"main.go"}`,
	} {
		if _, err := handler.HandleRequest(context.Background(), "fs/read_text_file", jsonv1.RawMessage(request)); err == nil {
			t.Fatalf("request was not denied: %s", request)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := handler.HandleRequest(ctx, "fs/read_text_file", jsonv1.RawMessage(`{"sessionId":"session","path":"main.go"}`)); err == nil {
		t.Fatal("cancelled read was not stopped")
	}
}

func TestReadTextFileHonorsLinesAndReportsTruncation(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "lines.txt"), []byte("one\ntwo\nthree\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "large.txt"), []byte(strings.Repeat("x", maxACPReadBytes+100)), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(NewSettingsStore(t.TempDir()))
	manager.rootBySession["session"] = root
	handler := &handler{manager: manager}

	result, err := handler.readTextFile(context.Background(), jsonv1.RawMessage(`{"sessionId":"session","path":"lines.txt","line":2,"limit":1}`))
	if err != nil {
		t.Fatal(err)
	}
	response := result.(map[string]any)
	if response["content"] != "two\n" {
		t.Fatalf("wrong line slice: %q", response["content"])
	}
	meta := response["_meta"].(map[string]any)["adomnia"].(map[string]bool)
	if !meta["truncated"] {
		t.Fatal("line truncation was not reported")
	}

	result, err = handler.readTextFile(context.Background(), jsonv1.RawMessage(`{"sessionId":"session","path":"large.txt"}`))
	if err != nil {
		t.Fatal(err)
	}
	response = result.(map[string]any)
	if len(response["content"].(string)) != maxACPReadBytes {
		t.Fatalf("read was not bounded: %d", len(response["content"].(string)))
	}
	meta = response["_meta"].(map[string]any)["adomnia"].(map[string]bool)
	if !meta["truncated"] {
		t.Fatal("byte truncation was not reported")
	}
}

func TestReadTextFileRejectsSymlinkLeavingProject(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link.txt")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink unavailable on this host: %v", err)
	}
	manager := NewManager(NewSettingsStore(t.TempDir()))
	manager.rootBySession["session"] = root
	if _, err := (&handler{manager: manager}).readTextFile(context.Background(), jsonv1.RawMessage(`{"sessionId":"session","path":"link.txt"}`)); err == nil {
		t.Fatal("symlink outside project was accepted")
	}
}
