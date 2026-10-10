package update

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func signedFixture(t *testing.T, m Manifest) ([]byte, string) {
	t.Helper()
	pub, key, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	payload, _ := json.Marshal(m)
	raw, _ := json.Marshal(Envelope{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))})
	return raw, base64.StdEncoding.EncodeToString(pub)
}
func TestSignedManifestRejectsTampering(t *testing.T) {
	raw, key := signedFixture(t, Manifest{Version: "v0.10.0-beta.2"})
	if _, e := VerifyEnvelope(raw, key); e != nil {
		t.Fatal(e)
	}
	var env Envelope
	_ = json.Unmarshal(raw, &env)
	env.Payload = base64.StdEncoding.EncodeToString([]byte(`{"version":"v99.0.0"}`))
	tampered, _ := json.Marshal(env)
	if _, e := VerifyEnvelope(tampered, key); e == nil {
		t.Fatal("tampered manifest accepted")
	}
	if _, e := VerifyEnvelope(raw, ""); e == nil {
		t.Fatal("missing publisher key accepted")
	}
}
func TestReleaseChannelsRequireCompleteSignedRelease(t *testing.T) {
	ready := []releaseAsset{{Name: "update-manifest.json"}}
	list := []release{{Tag: "v0.10.0-beta.10", Prerelease: true, Assets: ready}, {Tag: "v0.10.0-beta.2", Prerelease: true, Assets: ready}, {Tag: "v0.11.0", Assets: ready}, {Tag: "v99.0.0", Draft: true, Assets: ready}, {Tag: "v100.0.0"}}
	if got := chooseRelease(list, "v0.10.0-beta.1", "beta"); got == nil || got.Tag != "v0.11.0" {
		t.Fatalf("wrong beta choice: %#v", got)
	}
	if got := chooseRelease(list[:2], "v0.10.0-beta.1", "stable"); got != nil {
		t.Fatal("stable receives beta")
	}
	if got := chooseRelease(list[:2], "v0.10.0-beta.1", "beta"); got == nil || got.Tag != "v0.10.0-beta.10" {
		t.Fatal("beta ordering broken")
	}
}
func TestArchiveRejectsTraversalAndSymlinks(t *testing.T) {
	for _, name := range []string{"../escape", "/escape", "a/../../escape", "C:/escape", `a\escape`} {
		t.Run(name, func(t *testing.T) {
			var b bytes.Buffer
			z := zip.NewWriter(&b)
			f, _ := z.Create(name)
			_, _ = f.Write([]byte("x"))
			z.Close()
			dir := t.TempDir()
			p := filepath.Join(dir, "update.zip")
			_ = os.WriteFile(p, b.Bytes(), 0600)
			if e := extractPackage(p, filepath.Join(dir, "stage")); e == nil {
				t.Fatal("unsafe path accepted")
			}
		})
	}
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	h := &zip.FileHeader{Name: "link"}
	h.SetMode(os.ModeSymlink | 0777)
	f, _ := z.CreateHeader(h)
	_, _ = f.Write([]byte("../escape"))
	z.Close()
	dir := t.TempDir()
	p := filepath.Join(dir, "update.zip")
	_ = os.WriteFile(p, b.Bytes(), 0600)
	if e := extractPackage(p, filepath.Join(dir, "stage")); e == nil {
		t.Fatal("symlink accepted")
	}
}
func TestArchivePreservesExecutable(t *testing.T) {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	h := &zip.FileHeader{Name: "adomnia"}
	h.SetMode(0755)
	f, _ := z.CreateHeader(h)
	_, _ = f.Write([]byte("app"))
	z.Close()
	dir := t.TempDir()
	p := filepath.Join(dir, "update.zip")
	_ = os.WriteFile(p, b.Bytes(), 0600)
	if e := extractPackage(p, filepath.Join(dir, "stage")); e != nil {
		t.Fatal(e)
	}
	body, e := os.ReadFile(filepath.Join(dir, "stage", "adomnia"))
	if e != nil || string(body) != "app" {
		t.Fatal("binary missing")
	}
}
func TestUpdateURLAllowlist(t *testing.T) {
	for _, s := range []string{"http://github.com/Andrea-Cavallo/adOmnia/releases/download/v1/x", "https://evil.test/x", "https://github.com@evil.test/x", "https://github.com/other/repo/releases/download/v1/x"} {
		if allowedURL(s) {
			t.Fatal("untrusted URL accepted")
		}
	}
	if !allowedURL("https://github.com/Andrea-Cavallo/adOmnia/releases/download/v1/x") {
		t.Fatal("publisher URL rejected")
	}
}
func TestDevBuildDoesNotCheckNetwork(t *testing.T) {
	m := NewManager(t.TempDir(), "dev")
	s, e := m.Check("beta", true)
	if e != nil || s.Phase != "dev" {
		t.Fatal(s, e)
	}
	if _, e = m.Check("nightly", true); e == nil {
		t.Fatal("invalid channel accepted")
	}
}
