package netpolicy

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOfflineBlocksRemoteButNotLoopback(t *testing.T) {
	Configure(t.TempDir())
	ClearActivity()
	if _, err := Save(Settings{Offline: true}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = Save(Settings{}) })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer server.Close()
	client := Client("test", 5*time.Second)
	response, err := client.Get(server.URL + "/local?secret=1")
	if err != nil {
		t.Fatalf("loopback must stay reachable offline: %v", err)
	}
	response.Body.Close()
	if _, err := client.Get("https://example.com/"); !errors.Is(err, ErrOffline) {
		t.Fatalf("remote host must be blocked offline, got %v", err)
	}

	events := Activity()
	if len(events) != 2 || events[0].Outcome != OutcomeBlocked || events[1].Status != http.StatusNoContent {
		t.Fatalf("unexpected activity: %+v", events)
	}
	if events[1].Path != "/local" {
		t.Fatalf("activity must not keep the query string: %q", events[1].Path)
	}
}

func TestProxyHonoursNoProxy(t *testing.T) {
	Configure(t.TempDir())
	if _, err := Save(Settings{ProxyURL: "http://proxy.corp:8080", NoProxy: "git.corp"}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = Save(Settings{}) })
	proxy := ProxyFunc()
	via, _ := proxy(&http.Request{URL: &url.URL{Scheme: "https", Host: "api.openai.com"}})
	if via == nil || via.Host != "proxy.corp:8080" {
		t.Fatalf("expected corporate proxy, got %v", via)
	}
	direct, _ := proxy(&http.Request{URL: &url.URL{Scheme: "https", Host: "git.corp"}})
	if direct != nil {
		t.Fatalf("NO_PROXY host must be reached directly, got %v", direct)
	}
}

func TestValidateRejectsPasswordAndBadBundle(t *testing.T) {
	if _, err := (Settings{ProxyURL: "http://user:secret@proxy:8080"}).Validate(); err == nil {
		t.Fatal("a password in the proxy URL must be rejected")
	}
	bundle := filepath.Join(t.TempDir(), "ca.pem")
	_ = os.WriteFile(bundle, []byte("not a certificate"), 0o600)
	if _, err := (Settings{CABundlePath: bundle}).Validate(); err == nil {
		t.Fatal("a bundle without PEM certificates must be rejected")
	}
}

func TestProcessEnvironmentOfflineOverridesProject(t *testing.T) {
	Configure(t.TempDir())
	if _, err := Save(Settings{Offline: true, ProxyURL: "http://proxy:3128"}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = Save(Settings{}) })
	env := map[string]string{"GOPROXY": "https://proxy.golang.org", "HTTPS_PROXY": "http://project:1"}
	ProcessEnvironment(env)
	if env["GOPROXY"] != "off" || env["GOSUMDB"] != "off" || env["GOTOOLCHAIN"] != "local" {
		t.Fatalf("offline must force the Go toolchain offline: %v", env)
	}
	if env["HTTPS_PROXY"] != "http://project:1" || env["HTTP_PROXY"] != "http://proxy:3128" {
		t.Fatalf("project proxy wins, app proxy fills the gaps: %v", env)
	}
}

func TestActivityKeepsMostRecent(t *testing.T) {
	ClearActivity()
	for index := 0; index < activityLimit+10; index++ {
		Record(Event{Host: "h", Status: index})
	}
	events := Activity()
	if len(events) != activityLimit || events[0].Status != activityLimit+9 {
		t.Fatalf("ring buffer broken: len=%d first=%d", len(events), events[0].Status)
	}
}
