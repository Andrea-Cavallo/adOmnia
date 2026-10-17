package preview

import (
	"strings"
	"testing"
)

func TestURLScannerPrefersLocalLineAndNormalizes(t *testing.T) {
	scanner := NewURLScanner()
	output := "\x1b[32m  VITE v5.0\x1b[39m ready in 300 ms\n  \x1b[1m➜\x1b[22m  Local:   \x1b[36mhttp://localhost:\x1b[1m5174\x1b[22m/\x1b[39m\n  ➜  Network: http://192.168.1.4:5174/\n"
	url, changed := scanner.Feed("stdout", []byte(output))
	if !changed || url != "http://localhost:5174/" {
		t.Fatalf("got %q (changed=%v)", url, changed)
	}
	if again, changed := scanner.Feed("stdout", []byte("hmr update\n")); changed || again != url {
		t.Fatal("an unrelated line must not change the URL")
	}
}

func TestURLScannerHandlesChunkedAndWildcardHosts(t *testing.T) {
	scanner := NewURLScanner()
	for _, chunk := range []string{"ready - started server on 0.0.0.0:3", "000, url: http://0.0.0.0:3000\n"} {
		scanner.Feed("stdout", []byte(chunk))
	}
	if url, _ := scanner.Feed("stdout", nil); url != "http://127.0.0.1:3000" {
		t.Fatalf("got %q", url)
	}
}

func TestClassifyExit(t *testing.T) {
	cases := map[string]string{
		"Error: listen EADDRINUSE: address already in use :::3000":    FailurePortInUse,
		"'vite' is not recognized as an internal or external command": FailureMissingDeps,
		"sh: 1: vite: not found":                                      FailureMissingDeps,
		"SyntaxError: boom":                                           FailureExited,
	}
	for output, want := range cases {
		if kind, _ := classifyExit(output, 1, false); kind != want {
			t.Errorf("%q → %s, want %s", output, kind, want)
		}
	}
}

func TestLiveEventForClassifiesChanges(t *testing.T) {
	root := t.TempDir()
	if event, ok := liveEventFor(root, []string{root + "/a.css", root + "/b.CSS"}); !ok || event.Type != "css" {
		t.Fatalf("css only: %+v %v", event, ok)
	}
	if event, ok := liveEventFor(root, []string{root + "/a.css", root + "/index.html"}); !ok || event.Type != "reload" {
		t.Fatalf("mixed: %+v %v", event, ok)
	}
	if _, ok := liveEventFor(root, []string{root + "/node_modules/x/y.js", root + "/.git/HEAD", "/elsewhere/file.js"}); ok {
		t.Fatal("ignored and outside paths must not trigger a reload")
	}
}

func TestInjectLiveClientPrefersHeadSoEarlyErrorsAreSeen(t *testing.T) {
	page := []byte("<!doctype html><html><head><title>t</title></head><body><script src=\"app.js\"></script></body></html>")
	out := string(injectLiveClient(page))
	if at, app := strings.Index(out, "live.js"), strings.Index(out, "app.js"); at < 0 || at > app {
		t.Fatalf("the bridge must load before the page scripts: %s", out)
	}
	if bare := string(injectLiveClient([]byte("<p>fragment</p>"))); !strings.Contains(bare, "live.js") {
		t.Fatalf("a fragment still gets the bridge: %s", bare)
	}
	if noHead := string(injectLiveClient([]byte("<body>x</body>"))); strings.Index(noHead, "live.js") > strings.Index(noHead, "</body>") {
		t.Fatalf("without a head the bridge goes before </body>: %s", noHead)
	}
}
