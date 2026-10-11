package goide

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestReadProjectKeystoreOpaqueBoundedAndContained(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module fixture.test/project\n"), 0600)
	outside := filepath.Join(t.TempDir(), "outside.jks")
	if err := os.WriteFile(outside, []byte("opaque"), 0600); err != nil {
		t.Fatal(err)
	}
	content := []byte{0xfe, 0xed, 0xfe, 0xed, 0, 0xff}
	os.WriteFile(filepath.Join(root, "client.jks"), content, 0600)
	os.WriteFile(filepath.Join(root, "empty.p12"), nil, 0600)
	os.WriteFile(filepath.Join(root, "wrong.txt"), content, 0600)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := service.ReadProjectKeystore(string(session.ID), "client.jks")
	if err != nil || encoded != base64.StdEncoding.EncodeToString(content) {
		t.Fatalf("opaque bytes: %q %v", encoded, err)
	}
	for _, path := range []string{"empty.p12", "wrong.txt", "../outside.jks", outside, root} {
		if _, err := service.ReadProjectKeystore(string(session.ID), path); err == nil {
			t.Errorf("accepted invalid path %q", path)
		}
	}
}
