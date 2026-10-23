package lsp

import (
	"encoding/json/v2"
	"strings"
	"testing"
)

func TestHoverContentsVariants(t *testing.T) {
	for _, raw := range []string{
		`{"contents":{"kind":"markdown","value":"static final int LIMIT = 42"}}`,
		`{"contents":"static final int LIMIT = 42"}`,
		`{"contents":[{"language":"java","value":"static final int LIMIT = 42"},"Maximum allowed"]}`,
	} {
		var hover Hover
		if err := json.Unmarshal([]byte(raw), &hover); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(hover.Contents.Value, "LIMIT = 42") {
			t.Fatalf("constant value lost: %+v", hover)
		}
	}
}
