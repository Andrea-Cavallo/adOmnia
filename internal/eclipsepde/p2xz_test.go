package eclipsepde

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/ulikunitz/xz"
)

// Many recent Eclipse repositories publish their metadata only as content.xml.xz.
func TestDownloadTargetP2ReadsAnXZOnlyRepository(t *testing.T) {
	useTempP2Cache(t)
	repo := writeFakeP2Repository(t, "")
	child := filepath.Join(repo, "child")
	if err := os.Remove(filepath.Join(child, "content.jar")); err != nil {
		t.Fatal(err)
	}
	var compressed bytes.Buffer
	writer, err := xz.NewWriter(&compressed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte(fakeP2Content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	writeText(t, filepath.Join(child, "content.xml.xz"), compressed.String())

	result, err := DownloadTargetP2(context.Background(), fakeTargetWorkspace(t, repo), nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Bundles != 2 || len(result.Problems) != 0 {
		t.Fatalf("result = %+v", result)
	}
}
