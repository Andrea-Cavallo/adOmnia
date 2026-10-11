package goide

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestProjectPDFPreservesBytesAndRejectsEscape(t *testing.T) {
	root := t.TempDir()
	data := append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte("x"), int(MaxDocumentBytes)+1)...)
	if err := os.WriteFile(filepath.Join(root, "guide.pdf"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "fake.pdf"), []byte("not a pdf"), 0600); err != nil {
		t.Fatal(err)
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := service.ReadProjectPDF(string(session.ID), "guide.pdf")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || !bytes.Equal(data, decoded) {
		t.Fatal("PDF bytes changed")
	}
	if _, err := service.ReadProjectPDF(string(session.ID), "fake.pdf"); err == nil {
		t.Fatal("invalid PDF accepted")
	}
	outside := filepath.Join(t.TempDir(), "outside.pdf")
	_ = os.WriteFile(outside, []byte("%PDF-1.7"), 0600)
	if _, err := service.ReadProjectPDF(string(session.ID), outside); err == nil {
		t.Fatal("outside file accepted")
	}
}
