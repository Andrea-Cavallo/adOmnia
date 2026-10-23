package preview

import (
	"os"
	"path/filepath"
	"testing"
)

// A path whose real target is outside the served folder must look exactly like a path that does not exist:
// same status and same body, so the server cannot be used to probe which files exist elsewhere on the disk.
// It needs a real symlink: it is skipped where symlinks are unavailable (unprivileged Windows) and runs on Linux/macOS CI.
func TestStaticServerDoesNotRevealWhatExistsOutsideTheRoot(t *testing.T) {
	server, root := newSite(t)
	outside := t.TempDir()
	write(t, filepath.Join(outside, "secret.txt"), "top secret")
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	missingStatus, missingBody := get(t, server.URL()+"missing/secret.txt")
	for _, target := range []string{"escape/secret.txt", "escape/no-such-file"} {
		status, body := get(t, server.URL()+target)
		if status != missingStatus || body != missingBody {
			t.Errorf("%s answered %d %q, a missing file answers %d %q", target, status, body, missingStatus, missingBody)
		}
	}
}
