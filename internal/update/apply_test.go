package update

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == "--update-test-parent" {
		time.Sleep(200 * time.Millisecond)
		os.Exit(0)
	}
	if key := os.Getenv("ADOMNIA_TEST_UPDATE_KEY"); key != "" {
		PublicKey = key
	}
	if len(os.Args) == 3 && os.Args[1] == "--adomnia-update-helper" {
		if e := RunHelper(os.Args[2], "v1.0.0"); e != nil {
			os.Exit(2)
		}
		os.Exit(0)
	}
	if os.Getenv("ADOMNIA_TEST_INSTALLED") == "1" && os.Getenv("ADOMNIA_UPDATE_CONFIRM") == "" {
		os.Exit(0)
	}
	if os.Getenv("ADOMNIA_UPDATE_CONFIRM") != "" {
		if os.Getenv("ADOMNIA_TEST_UPDATE_FAIL") == "1" {
			os.Exit(3)
		}
		if e := ConfirmStartup("v1.1.0"); e != nil {
			os.Exit(4)
		}
		time.Sleep(time.Second)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// Executes real Windows/Linux file replacement and startup confirmation in an
// isolated temporary install. It never opens or replaces the user's app.
func TestNativeHelperApplyAndRollback(t *testing.T) {
	if runtime.GOOS == "darwin" {
		t.Skip("macOS bundle/codesign acceptance requires a packaged app")
	}
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "apply", true: "rollback"}[fail], func(t *testing.T) {
			root := t.TempDir()
			stage := filepath.Join(root, "updates")
			if e := os.Mkdir(stage, 0700); e != nil {
				t.Fatal(e)
			}
			self, e := os.Executable()
			if e != nil {
				t.Fatal(e)
			}
			entry := "adomnia"
			if runtime.GOOS == "windows" {
				entry += ".exe"
			}
			target := filepath.Join(root, entry)
			userFiles := []string{"workspace.adomnia", "settings.json", "unsaved-request.json"}
			for _, name := range userFiles {
				if e := os.WriteFile(filepath.Join(root, name), []byte("user modifications: "+name), 0600); e != nil { t.Fatal(e) }
			}
			helper := filepath.Join(stage, "helper.exe")
			if e = copyRegular(self, target, 0700); e != nil {
				t.Fatal(e)
			}
			if e = copyRegular(self, helper, 0700); e != nil {
				t.Fatal(e)
			}
			data, e := os.ReadFile(self)
			if e != nil {
				t.Fatal(e)
			}
			var b bytes.Buffer
			z := zip.NewWriter(&b)
			h := &zip.FileHeader{Name: entry}
			h.SetMode(0755)
			f, _ := z.CreateHeader(h)
			_, _ = f.Write(data)
			z.Close()
			archive := filepath.Join(stage, "package.zip")
			if e = os.WriteFile(archive, b.Bytes(), 0600); e != nil {
				t.Fatal(e)
			}
			hash := sha256.Sum256(b.Bytes())
			pub, key, e := ed25519.GenerateKey(rand.Reader)
			if e != nil {
				t.Fatal(e)
			}
			payload, _ := json.Marshal(Manifest{Version: "v1.1.0", Assets: []Asset{{OS: runtime.GOOS, Arch: runtime.GOARCH, Size: int64(b.Len()), SHA256: hex.EncodeToString(hash[:])}}})
			raw, _ := json.Marshal(Envelope{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))})
			manifest := filepath.Join(stage, "manifest.json")
			_ = os.WriteFile(manifest, raw, 0600)
			parent := exec.Command(self, "--update-test-parent")
			if e = parent.Start(); e != nil {
				t.Fatal(e)
			}
			plan := applyPlan{Target: target, Executable: target, Archive: archive, Manifest: manifest, Version: "v1.1.0", Parent: parent.Process.Pid}
			raw, _ = json.Marshal(plan)
			planFile := filepath.Join(stage, "plan.json")
			_ = os.WriteFile(planFile, raw, 0600)
			cmd := exec.Command(helper, "--adomnia-update-helper", planFile)
			cmd.Env = append(os.Environ(), "ADOMNIA_TEST_INSTALLED=1", "ADOMNIA_TEST_UPDATE_KEY="+base64.StdEncoding.EncodeToString(pub))
			if fail {
				cmd.Env = append(cmd.Env, "ADOMNIA_TEST_UPDATE_FAIL=1")
			}
			e = cmd.Run()
			_ = parent.Wait()
			if fail && e == nil {
				t.Fatal("failed startup accepted")
			}
			if !fail && e != nil {
				t.Fatal(e)
			}
			if _, e = os.Stat(target); e != nil {
				t.Fatal("app lost after update", e)
			}
			if _, e = os.Stat(target + ".adomnia-previous"); !os.IsNotExist(e) {
				t.Fatal("backup was not finalized/restored")
			}
			time.Sleep(1200 * time.Millisecond) // allow the isolated restarted fixture to exit
			for _, name := range userFiles {
				data, err := os.ReadFile(filepath.Join(root, name))
				if err != nil || string(data) != "user modifications: "+name { t.Fatalf("user data changed: %s: %v", name, err) }
			}
		})
	}
}

type memoryTransport func(*http.Request) (*http.Response, error)

func (f memoryTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestDownloadVerifiesPackageAndRejectsBadHash(t *testing.T) {
	old := PublicKey
	defer func() { PublicKey = old }()
	for _, bad := range []bool{false, true} {
		t.Run(map[bool]string{false: "verified", true: "tampered"}[bad], func(t *testing.T) {
			var b bytes.Buffer
			z := zip.NewWriter(&b)
			f, _ := z.Create("adomnia.exe")
			_, _ = f.Write([]byte("fixture"))
			z.Close()
			hash := sha256.Sum256(b.Bytes())
			digest := hex.EncodeToString(hash[:])
			if bad {
				digest = hex.EncodeToString(make([]byte, 32))
			}
			url := "https://github.com/Andrea-Cavallo/adOmnia/releases/download/v1.1.0/package.zip"
			raw, key := signedFixture(t, Manifest{Version: "v1.1.0", Assets: []Asset{{OS: runtime.GOOS, Arch: runtime.GOARCH, URL: url, Size: int64(b.Len()), SHA256: digest}}})
			PublicKey = key
			m := NewManager(t.TempDir(), "v1.0.0")
			m.selected = release{Tag: "v1.1.0", Assets: []releaseAsset{{Name: "update-manifest.json", URL: url + ".manifest"}}}
			m.client = func(time.Duration) *http.Client {
				return &http.Client{Transport: memoryTransport(func(r *http.Request) (*http.Response, error) {
					body := raw
					if r.URL.String() == url {
						body = b.Bytes()
					}
					return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header)}, nil
				})}
			}
			if _, e := m.Download(); e != nil {
				t.Fatal(e)
			}
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				m.mu.Lock()
				busy := m.busy
				m.mu.Unlock()
				if !busy {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			s := m.Status()
			if bad && s.Phase != "error" {
				t.Fatal("bad hash accepted", s)
			}
			if !bad && (s.Phase != "ready" || s.Received != s.Total) {
				t.Fatal("verified download not ready", s)
			}
		})
	}
}
func TestCheckUsesCacheAndETag(t *testing.T) {
	m := NewManager(t.TempDir(), "v1.0.0")
	calls := 0
	m.client = func(time.Duration) *http.Client {
		return &http.Client{Transport: memoryTransport(func(r *http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				return &http.Response{StatusCode: 200, Header: http.Header{"Etag": []string{"fixture-etag"}}, Body: io.NopCloser(bytes.NewBufferString(`[{"tag_name":"v1.1.0","assets":[{"name":"update-manifest.json"}]}]`))}, nil
			}
			if r.Header.Get("If-None-Match") != "fixture-etag" {
				t.Error("missing conditional request")
			}
			return &http.Response{StatusCode: 304, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(nil))}, nil
		})}
	}
	if _, e := m.Check("stable", false); e != nil {
		t.Fatal(e)
	}
	if _, e := m.Check("stable", false); e != nil {
		t.Fatal(e)
	}
	if calls != 1 {
		t.Fatal("cached check repeated network request")
	}
	if _, e := m.Check("stable", true); e != nil {
		t.Fatal(e)
	}
	if calls != 2 {
		t.Fatal("manual check did not revalidate")
	}
}
