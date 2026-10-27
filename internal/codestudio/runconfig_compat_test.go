package codestudio

import (
	"encoding/json/v2"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"reflect"
	"testing"
)

// roundTrip imports a shared-file payload the way importSharedRunConfigurations does
// and re-emits it the way syncSharedRunConfigurations does.
func roundTrip(t *testing.T, payload string) map[string]any {
	t.Helper()
	var file sharedRunConfigurations
	if err := json.Unmarshal([]byte(payload), &file); err != nil {
		t.Fatal(err)
	}
	manager := NewRunConfigManager()
	for _, config := range file.Configurations {
		if !manager.Import("s1", config) {
			t.Fatalf("import rejected %q", config.Name)
		}
	}
	data, err := jsonutil.Marshal(sharedRunConfigurations{Format: file.Format, Version: file.Version, Configurations: manager.List("s1")})
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Configurations []map[string]any `json:"configurations"`
	}
	if err := json.Unmarshal(data, &out); err != nil || len(out.Configurations) != 1 {
		t.Fatalf("unexpected output %s (%v)", data, err)
	}
	return out.Configurations[0]
}

const legacyGoConfig = `{"format":"adomnia-run-configurations","version":1,"configurations":[
 {"id":"c1","name":"API","kind":"package","target":"./cmd/api","workingDirectory":".",
  "goArguments":["-v"],"buildTags":["integration"],"goos":"linux","goarch":"amd64","race":true,
  "programArguments":[],"environment":[],"docker":{},"shared":true}]}`

func TestLegacyFlatGoFieldsMigrateToLanguageOptionsAndStayFlat(t *testing.T) {
	out := roundTrip(t, legacyGoConfig)
	options, _ := out["languageOptions"].(map[string]any)
	if options["goos"] != "linux" || options["race"] != true {
		t.Fatalf("languageOptions missing Go fields: %v", options)
	}
	// A previous version reads only the flat fields: they must still be emitted.
	if out["goos"] != "linux" || out["goarch"] != "amd64" || out["race"] != true || !reflect.DeepEqual(out["buildTags"], []any{"integration"}) || !reflect.DeepEqual(out["goArguments"], []any{"-v"}) {
		t.Fatalf("flat fields lost: %v", out)
	}
}

func TestNewFormatWithOnlyLanguageOptionsFillsFlatFields(t *testing.T) {
	payload := `{"format":"adomnia-run-configurations","version":1,"configurations":[
 {"id":"c1","name":"API","language":"go","kind":"test","target":".","workingDirectory":".",
  "languageOptions":{"goos":"darwin","coverage":true,"profile":"cpu"},
  "programArguments":[],"environment":[],"docker":{},"shared":true}]}`
	out := roundTrip(t, payload)
	if out["goos"] != "darwin" || out["coverage"] != true || out["profile"] != "cpu" {
		t.Fatalf("flat fields not derived from languageOptions: %v", out)
	}
}

// TestRealWorkspaceGoConfigSurvives is the phase-3 gate: a config written by an older build
// (flat Go fields, go-tool kind) loads, validates and is re-saved without losing any field.
func TestRealWorkspaceGoConfigSurvives(t *testing.T) {
	out := roundTrip(t, `{"format":"adomnia-run-configurations","version":1,"configurations":[
 {"id":"t1","name":"Vet","kind":"go-tool","target":"vet","workingDirectory":".","programArguments":["./..."],"environment":[],"docker":{},"shared":true}]}`)
	if out["kind"] != "go-tool" || out["target"] != "vet" {
		t.Fatalf("go-tool changed: %v", out)
	}
	if args, _ := out["programArguments"].([]any); len(args) != 1 || args[0] != "./..." {
		t.Fatalf("arguments lost: %v", out["programArguments"])
	}
}
