package preview

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A directory inside the root whose index.html is a symlink to a file outside it must not be served.
func TestStaticServerRefusesAnIndexSymlinkOutsideTheRoot(t *testing.T) {
	server, root := newSite(t)
	outside := t.TempDir()
	write(t, filepath.Join(outside, "index.html"), "outside secret")
	if err := os.MkdirAll(filepath.Join(root, "linked"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "index.html"), filepath.Join(root, "linked", "index.html")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if status, body := get(t, server.URL()+"linked/"); status == 200 || strings.Contains(body, "outside secret") {
		t.Fatalf("an index symlink escaped the root: %d %q", status, body)
	}
}

// Names that still contain ".." after cleaning are refused outright; normal dotted names keep working.
func TestStaticServerRefusesNamesWithDoubleDots(t *testing.T) {
	server, root := newSite(t)
	write(t, filepath.Join(root, "a..b.txt"), "odd name")
	write(t, filepath.Join(root, "app.min.js"), "ok")
	if status, _ := get(t, server.URL()+"a..b.txt"); status == 200 {
		t.Fatal("a name containing .. must not be served")
	}
	if status, body := get(t, server.URL()+"app.min.js"); status != 200 || body != "ok" {
		t.Fatalf("a regular dotted name must keep working: %d %q", status, body)
	}
}
