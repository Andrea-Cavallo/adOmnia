package copilot

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fakeTarball(t *testing.T, name string, content []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	compressed := gzip.NewWriter(&buffer)
	archive := tar.NewWriter(compressed)
	for _, entry := range []struct {
		name string
		body []byte
	}{{"package/README.md", []byte("readme")}, {name, content}} {
		if err := archive.WriteHeader(&tar.Header{Name: entry.name, Mode: 0o755, Size: int64(len(entry.body)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		_, _ = archive.Write(entry.body)
	}
	_ = archive.Close()
	_ = compressed.Close()
	return buffer.Bytes()
}

// fakeRegistry serve metadata e tarball via TLS; il certificato del server diventa il CA bundle,
// così il test copre anche il supporto al CA aziendale.
func fakeRegistry(t *testing.T, tarball []byte, integrity string) (*Installer, Settings) {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/latest") {
			_ = json.NewEncoder(w).Encode(map[string]any{"version": "1.2.3", "dist": map[string]string{"tarball": server.URL + "/pkg.tgz", "integrity": integrity}})
			return
		}
		_, _ = w.Write(tarball)
	}))
	t.Cleanup(server.Close)
	caPath := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(caPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0o600); err != nil {
		t.Fatal(err)
	}
	installer := NewInstaller(t.TempDir())
	installer.registry = server.URL + "/"
	installer.goos, installer.goarch = "linux", "amd64"
	settings := DefaultSettings()
	settings.CABundlePath = caPath
	return installer, settings
}

func integrityOf(data []byte) string {
	sum := sha512.Sum512(data)
	return integrityPrefix + base64.StdEncoding.EncodeToString(sum[:])
}

func TestInstallVerifiesIntegrityAndExtractsOnlyTheBinary(t *testing.T) {
	tarball := fakeTarball(t, "package/copilot-language-server", []byte("#!/bin/sh\necho ok\n"))
	installer, settings := fakeRegistry(t, tarball, integrityOf(tarball))
	binary, err := installer.Install(context.Background(), settings, nil)
	if err != nil {
		t.Fatal(err)
	}
	if binary.Version != "1.2.3" || binary.Source != "managed" {
		t.Fatalf("unexpected binary: %+v", binary)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(binary.Path), "README.md")); err == nil {
		t.Fatal("only the executable must be extracted")
	}
	resolved, err := installer.Resolve(DefaultSettings())
	if err != nil || resolved.Path != binary.Path {
		t.Fatalf("installed binary not resolved: %+v %v", resolved, err)
	}
}

func TestInstallRejectsTamperedDownload(t *testing.T) {
	tarball := fakeTarball(t, "package/copilot-language-server", []byte("binary"))
	installer, settings := fakeRegistry(t, tarball, integrityOf([]byte("something else")))
	if _, err := installer.Install(context.Background(), settings, nil); err == nil || !strings.Contains(err.Error(), "integrity") {
		t.Fatalf("expected integrity failure, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(installer.directory, "1.2.3", "copilot-language-server")); err == nil {
		t.Fatal("tampered download must not be installed")
	}
}

func TestPlatformPackage(t *testing.T) {
	installer := &Installer{goos: "windows", goarch: "arm64"}
	if pkg, err := installer.PlatformPackage(); err != nil || pkg != "@github/copilot-language-server-win32-arm64" {
		t.Fatalf("got %q %v", pkg, err)
	}
	installer = &Installer{goos: "freebsd", goarch: "amd64"}
	if _, err := installer.PlatformPackage(); err == nil {
		t.Fatal("unsupported platform must fail")
	}
}
