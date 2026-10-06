package milk

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVersionAtLeast(t *testing.T) {
	cases := []struct {
		version string
		want    bool
	}{
		{"milk version v0.0.3 (commit 3f83d65)", false},
		{"v0.3.3", false},
		{"v0.4.0", true},
		{"v0.10.0", true},
		{"v1.0.0", true},
		{"garbage", false},
	}
	for _, c := range cases {
		if got := versionAtLeast(c.version, MinVersion); got != c.want {
			t.Errorf("versionAtLeast(%q) = %v, want %v", c.version, got, c.want)
		}
	}
}

func TestPickReleaseTakesNewestUsablePrerelease(t *testing.T) {
	asset := assetName()
	with := func(tag string) release {
		return release{Tag: tag, Prerelease: true, Assets: []releaseAsset{{Name: asset, URL: "b"}, {Name: asset + ".sha256", URL: "s"}}}
	}
	releases := []release{with("v0.3.3"), with("v0.4.0"), {Tag: "v0.5.0", Assets: []releaseAsset{{Name: asset, URL: "b"}}}, with("v0.4.2")}
	chosen, _, _, err := pickRelease(releases, asset)
	if err != nil || chosen.Tag != "v0.4.2" {
		t.Fatalf("expected v0.4.2 (v0.5.0 has no checksum), got %q %v", chosen.Tag, err)
	}
	if _, _, _, err := pickRelease([]release{with("v0.3.3")}, asset); err == nil {
		t.Fatal("expected an error when no release has serve --acp")
	}
}

func serveRelease(t *testing.T, binary []byte, checksum string) string {
	t.Helper()
	asset := assetName()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/releases":
			_ = json.NewEncoder(w).Encode([]release{{Tag: "v0.4.0", Prerelease: true, Assets: []releaseAsset{
				{Name: asset, URL: server.URL + "/bin", Size: int64(len(binary))},
				{Name: asset + ".sha256", URL: server.URL + "/sum"},
			}}})
		case "/bin":
			_, _ = w.Write(binary)
		case "/sum":
			_, _ = w.Write([]byte(checksum + "  " + asset + "\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	previous := releasesAPI
	releasesAPI = server.URL + "/releases"
	t.Cleanup(func() { releasesAPI = previous })
	return server.URL
}

func TestInstallReleaseVerifiesChecksum(t *testing.T) {
	binary := []byte("milk binary")
	sum := sha256.Sum256(binary)
	serveRelease(t, binary, hex.EncodeToString(sum[:]))
	destination := filepath.Join(t.TempDir(), "bin", "milk")
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}

	tag, err := installRelease(context.Background(), http.DefaultClient, destination, func(string) {})
	if err != nil || tag != "v0.4.0" {
		t.Fatalf("install: %q %v", tag, err)
	}
	if got, _ := os.ReadFile(destination); string(got) != "milk binary" {
		t.Fatalf("binary not replaced: %q", got)
	}
}

func TestInstallReleaseRejectsBadChecksum(t *testing.T) {
	serveRelease(t, []byte("tampered"), strings.Repeat("0", 64))
	destination := filepath.Join(t.TempDir(), "milk")
	if err := os.WriteFile(destination, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := installRelease(context.Background(), http.DefaultClient, destination, func(string) {}); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("expected a checksum error, got %v", err)
	}
	if got, _ := os.ReadFile(destination); string(got) != "old" {
		t.Fatalf("a bad download must not replace milk: %q", got)
	}
	entries, _ := os.ReadDir(filepath.Dir(destination))
	if len(entries) != 1 {
		t.Fatalf("temporary download left behind: %v", entries)
	}
}
