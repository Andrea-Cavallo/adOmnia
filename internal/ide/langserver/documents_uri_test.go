package langserver

import "testing"

func TestServerURIsMatchOpenDocumentsRegardlessOfDriveLetterCase(t *testing.T) {
	state := &lspSession{byURI: map[string]DocumentID{"file:///C:/proj/src/main.rs": "doc-1"}}
	for _, uri := range []string{"file:///C:/proj/src/main.rs", "file:///c:/proj/src/main.rs"} {
		if id := state.documentIDFor(uri); id != "doc-1" {
			t.Fatalf("%s -> %q", uri, id)
		}
	}
	if id := state.documentIDFor("file:///c:/proj/src/other.rs"); id != "" {
		t.Fatalf("an unknown file must not match, got %q", id)
	}
}
