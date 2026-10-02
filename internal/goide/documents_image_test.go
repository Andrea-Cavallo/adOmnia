package goide

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenImageDocumentReturnsDataURL(t *testing.T) {
	root := t.TempDir()
	content := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01, 0x02, 0x03}
	if err := os.WriteFile(filepath.Join(root, "logo.png"), content, 0o640); err != nil {
		t.Fatal(err)
	}
	manager := NewDocumentManager()
	session := testSession(root)
	opened, err := manager.OpenDocument(session, "logo.png")
	if err != nil {
		t.Fatalf("open image: %v", err)
	}
	if opened.Document.Language != "image" || opened.Document.MediaType != "image/png" {
		t.Fatalf("image metadata wrong: %#v", opened.Document)
	}
	if !opened.Document.ReadOnly {
		t.Fatal("images must be read-only")
	}
	if opened.Content != "" {
		t.Fatalf("image content should be empty, got %q", opened.Content)
	}
	if !strings.HasPrefix(opened.DataURL, "data:image/png;base64,") {
		t.Fatalf("unexpected data URL prefix: %q", opened.DataURL)
	}
	expected := base64.StdEncoding.EncodeToString(content)
	if !strings.HasSuffix(opened.DataURL, expected) {
		t.Fatal("data URL does not encode the file")
	}
	if _, err := manager.SaveDocument(session, opened.Document.ID, "x", opened.DiskToken, false); err == nil {
		t.Fatal("saving an image must be rejected")
	}
}

func TestImageMimeType(t *testing.T) {
	cases := map[string]string{"a.PNG": "image/png", "a.jpg": "image/jpeg", "a.jpeg": "image/jpeg", "a.gif": "image/gif", "a.webp": "image/webp", "a.svg": "image/svg+xml"}
	for name, want := range cases {
		if got, ok := imageMimeType(name); !ok || got != want {
			t.Fatalf("imageMimeType(%q)=%q,%v want %q", name, got, ok, want)
		}
	}
	if _, ok := imageMimeType("main.go"); ok {
		t.Fatal("go files are not images")
	}
}
