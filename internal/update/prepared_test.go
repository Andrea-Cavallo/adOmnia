package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestReusePreparedDownloadVerifiesIdentityAndContent(t *testing.T) {
	dir := t.TempDir()
	stage := filepath.Join(dir, "verified-reuse")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	archive := []byte("a package whose bytes are checked before the helper extracts it")
	hash := sha256.Sum256(archive)
	asset := Asset{Name: "test.zip", URL: "https://github.com/Andrea-Cavallo/adOmnia/releases/download/v1.2.3/test.zip", OS: runtime.GOOS, Arch: runtime.GOARCH, Size: int64(len(archive)), SHA256: hex.EncodeToString(hash[:])}
	raw, key := signedFixture(t, Manifest{Version: "v1.2.3", Assets: []Asset{asset}})
	previous := PublicKey
	PublicKey = key
	t.Cleanup(func() { PublicKey = previous })
	for name, data := range map[string][]byte{stage + ".zip": archive, stage + ".json": raw} {
		if err := os.WriteFile(name, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	m := NewManager(dir, "v1.0.0")
	m.rememberPrepared(stage)
	m = NewManager(dir, "v1.0.0") // A new application process keeps the verified download.
	if m.reusePrepared(context.Background(), release{Tag: "v1.2.4"}) {
		t.Fatal("cached package reused for a different release")
	}
	if !m.reusePrepared(context.Background(), release{Tag: "v1.2.3"}) || m.prepared != stage {
		t.Fatal("complete signed package was not reused after restart")
	}
	if err := os.WriteFile(stage+".zip", []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if m.reusePrepared(context.Background(), release{Tag: "v1.2.3"}) {
		t.Fatal("tampered cached archive accepted")
	}
	if err := os.WriteFile(filepath.Join(dir, preparedDownloadFile), []byte("../verified-outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if m.reusePrepared(context.Background(), release{Tag: "v1.2.3"}) {
		t.Fatal("cache path traversal accepted")
	}
}
