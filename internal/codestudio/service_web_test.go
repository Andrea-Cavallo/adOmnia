package codestudio

import (
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"adomnia/internal/ide/preview"
)

func webProject(t *testing.T, files map[string]string) (*Service, Session) {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	return service, session
}

func trust(t *testing.T, service *Service, session Session) Session {
	t.Helper()
	trusted, err := service.SetToolAuthorization(string(session.ID), true)
	if err != nil {
		t.Fatal(err)
	}
	return trusted
}

func fetch(t *testing.T, address string) string {
	t.Helper()
	response, err := http.Get(address)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return string(body)
}

func TestUntrustedProjectCannotStartAPreview(t *testing.T) {
	service, session := webProject(t, map[string]string{"index.html": "<p>hi</p>"})
	if _, err := service.StartPreview(string(session.ID), PreviewRequest{Mode: PreviewModeStatic, Dir: "."}); err == nil {
		t.Fatal("an untrusted project must not start a server")
	}
	if _, err := service.InstallWebDependencies(string(session.ID), ".", true); err == nil {
		t.Fatal("an untrusted project must not install dependencies")
	}
	report, err := service.DetectWebProject(string(session.ID))
	if err != nil || report.Trusted || len(report.Targets) != 1 {
		t.Fatalf("detection must work without trust and run nothing: %+v %v", report, err)
	}
}

func TestStaticPreviewServesRemembersAndIsReleasedWithTheSession(t *testing.T) {
	service, session := webProject(t, map[string]string{"index.html": "<body>site</body>", "about.html": "<body>about</body>"})
	session = trust(t, service, session)
	started, err := service.StartPreview(string(session.ID), PreviewRequest{Mode: PreviewModeStatic, Dir: ".", Entry: "about.html"})
	if err != nil || started.State != preview.StateReady {
		t.Fatalf("start: %+v %v", started, err)
	}
	if body := fetch(t, started.URL); !strings.Contains(body, "site") || !strings.Contains(body, "live.js") {
		t.Fatalf("site not served with the bridge: %q", body)
	}
	address, err := service.ReadyPreviewURL(string(session.ID), started.ID)
	if err != nil || !strings.HasSuffix(address, "/about.html") {
		t.Fatalf("entry page URL: %q %v", address, err)
	}
	config, _ := service.GetPreviewConfig(string(session.ID))
	if config == nil || config.Mode != PreviewModeStatic || config.Entry != "about.html" {
		t.Fatalf("the last configuration must be remembered: %+v", config)
	}

	if err := service.CloseSession(string(session.ID)); err != nil {
		t.Fatalf("closing a session must stop its previews first: %v", err)
	}
	if !preview.PortAvailable(started.Port) {
		t.Fatal("the preview port is still held after closing the session")
	}
}

func TestRevokingTrustStopsPreviews(t *testing.T) {
	service, session := webProject(t, map[string]string{"index.html": "x"})
	session = trust(t, service, session)
	started, err := service.StartPreview(string(session.ID), PreviewRequest{Mode: PreviewModeStatic, Dir: "."})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), false); err != nil {
		t.Fatal(err)
	}
	if !preview.PortAvailable(started.Port) {
		t.Fatal("revoking trust must stop the preview")
	}
}

func TestPreviewFolderCannotEscapeTheProject(t *testing.T) {
	service, session := webProject(t, map[string]string{"index.html": "x"})
	session = trust(t, service, session)
	for _, dir := range []string{"..", "../other", "a/../../b"} {
		if _, err := service.StartPreview(string(session.ID), PreviewRequest{Mode: PreviewModeStatic, Dir: dir}); err == nil {
			t.Errorf("folder %q must be rejected", dir)
		}
	}
	if _, err := service.StartPreview(string(session.ID), PreviewRequest{Mode: PreviewModeStatic, Dir: ".", Entry: "../secret.html"}); err == nil {
		t.Error("an entry outside the folder must be rejected")
	}
}

func TestDevServerPreviewExplainsMissingDependencies(t *testing.T) {
	service, session := webProject(t, map[string]string{"package.json": `{"name":"app","scripts":{"dev":"vite"},"dependencies":{"react":"18"}}`})
	session = trust(t, service, session)
	started, err := service.StartPreview(string(session.ID), PreviewRequest{Mode: PreviewModeDevServer, Dir: "."})
	if err != nil {
		t.Fatal(err)
	}
	if started.State != preview.StateFailed {
		t.Fatalf("expected a failed preview, got %+v", started)
	}
	if started.FailureKind != preview.FailureMissingDeps && started.FailureKind != "runtime" {
		t.Fatalf("the failure must be explained, got %q", started.FailureKind)
	}
	if service.processes.HasActiveSession(session.ID) {
		t.Fatal("nothing may run when dependencies are missing")
	}
}

func TestDevServerPreviewRunsTheProjectScriptAndStopsItsProcessTree(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm is not installed")
	}
	service, session := webProject(t, map[string]string{
		"package.json": `{"name":"app","scripts":{"dev":"node server.js"}}`,
		"server.js": `const http = require('http')
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<body>app</body>') })
server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => console.log('Local: http://localhost:' + server.address().port + '/'))`,
	})
	session = trust(t, service, session)
	started, err := service.StartPreview(string(session.ID), PreviewRequest{Mode: PreviewModeDevServer, Dir: "."})
	if err != nil || started.State == preview.StateFailed {
		t.Fatalf("start: %+v %v", started, err)
	}
	var ready preview.Preview
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if current, ok := service.previews.Get(string(session.ID), started.ID); ok && current.State == preview.StateReady {
			ready = current
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if ready.ID == "" {
		t.Fatalf("the dev server never became ready: %+v", started)
	}
	if body := fetch(t, ready.URL); !strings.Contains(body, "app") {
		t.Fatalf("dev server page: %q", body)
	}
	if err := service.StopPreview(string(session.ID), started.ID); err != nil {
		t.Fatal(err)
	}
	if !waitUntil(func() bool { return preview.PortAvailable(ready.Port) }) {
		t.Fatal("the dev server process tree survived StopPreview")
	}
}

func waitUntil(condition func() bool) bool {
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}

func TestSavePreviewConfigKeepsWhatToRunAndRejectsBadValues(t *testing.T) {
	service, session := webProject(t, map[string]string{"index.html": "x"})
	session = trust(t, service, session)
	if _, err := service.StartPreview(string(session.ID), PreviewRequest{Mode: PreviewModeStatic, Dir: ".", Entry: "index.html"}); err != nil {
		t.Fatal(err)
	}
	if err := service.SavePreviewConfig(string(session.ID), PreviewConfig{Placement: "tab", Device: "tablet", Width: 99999, AutoReload: true}); err != nil {
		t.Fatal(err)
	}
	config, _ := service.GetPreviewConfig(string(session.ID))
	if config == nil || config.Mode != PreviewModeStatic || config.Dir != "." || config.Placement != "tab" || config.Device != "tablet" || config.Width != 10_000 {
		t.Fatalf("saving presentation must keep the run target and clamp the viewport: %+v", config)
	}
	for _, bad := range []PreviewConfig{{Placement: "floating"}, {Device: "watch"}} {
		if err := service.SavePreviewConfig(string(session.ID), bad); err == nil {
			t.Errorf("%+v must be rejected", bad)
		}
	}
}

func TestWebInstallsAndServersNeedTrustAndConfirmation(t *testing.T) {
	service, session := webProject(t, map[string]string{"package.json": `{"name":"a","dependencies":{"react":"18"}}`})
	id := string(session.ID)
	if _, err := service.InstallWebTools(id, true); err == nil {
		t.Error("an untrusted project must not install tools")
	}
	if _, err := service.StartWebLanguageServer(id, "typescript"); err == nil {
		t.Error("an untrusted project must not start a language server")
	}
	trust(t, service, session)
	if _, err := service.InstallWebTools(id, false); err == nil {
		t.Error("installing tools without explicit confirmation must fail")
	}
	if _, err := service.InstallWebDependencies(id, ".", false); err == nil {
		t.Error("installing dependencies without explicit confirmation must fail")
	}
}

func TestResolveProjectDirRejectsSymlinkAndTraversalEscapes(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	if dir, relative, err := resolveProjectDir(root, "app"); err != nil || relative != "app" || !strings.HasSuffix(dir, "app") {
		t.Fatalf("a folder inside the project is fine: %q %q %v", dir, relative, err)
	}
	if _, _, err := resolveProjectDir(root, "../x"); err == nil {
		t.Error("traversal must be rejected")
	}
	if _, _, err := resolveProjectDir(root, outside); err == nil {
		t.Error("an absolute path must be rejected")
	}
	if err := os.Symlink(outside, filepath.Join(root, "link")); err == nil {
		if _, _, err := resolveProjectDir(root, "link"); err == nil {
			t.Error("a symlink leaving the project must be rejected")
		}
	}
}

func TestStablePortIsDeterministicAndInRange(t *testing.T) {
	first, second := stablePort("C:/Work/Site"), stablePort("c:/work/site")
	if first != second {
		t.Fatalf("the same folder must always get the same port: %d vs %d", first, second)
	}
	if first < previewPortBase || first >= previewPortBase+previewPortRange {
		t.Fatalf("port %d out of range", first)
	}
}
