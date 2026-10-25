package codestudio

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDocumentLineEndingsSurviveSaveAndReopen(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(path, []byte("caffè\nseconda riga\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	session := testSession(root)
	manager := NewDocumentManager()
	opened, err := manager.OpenDocument(session, "notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{"caffè\r\nseconda riga\r\n", "caffè\nseconda riga\n"} {
		saved, saveErr := manager.SaveDocument(session, opened.Document.ID, content, opened.DiskToken, false)
		if saveErr != nil {
			t.Fatal(saveErr)
		}
		bytes, readErr := os.ReadFile(path)
		if readErr != nil || string(bytes) != content {
			t.Fatalf("saved bytes: %q, error: %v", bytes, readErr)
		}
		reopened, openErr := NewDocumentManager().OpenDocument(session, "notes.txt")
		if openErr != nil || reopened.Content != content {
			t.Fatalf("reopened content: %q, error: %v", reopened.Content, openErr)
		}
		opened = saved
	}
}
