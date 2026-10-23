package golang

import (
	jsonv1 "encoding/json"
	"testing"

	"adomnia/internal/ide/run"
	"adomnia/internal/jsonutil"
)

func TestRunSchemaOnlyExposesGoFieldsForBuildKinds(t *testing.T) {
	var provider run.SchemaProvider = New()
	keys := func(kind string) []string {
		var result []string
		for _, field := range provider.RunSchema(kind).Fields {
			if field.Section != run.SectionAdvanced {
				t.Fatalf("%s/%s must be advanced", kind, field.Key)
			}
			result = append(result, field.Key)
		}
		return result
	}
	if got := len(keys("run")); got != 7 {
		t.Fatalf("run fields = %d", got)
	}
	if got := keys("test"); got[len(got)-1] != "profile" {
		t.Fatalf("test must end with profile: %v", got)
	}
	if got := keys("command"); len(got) != 0 {
		t.Fatalf("command must have no Go fields: %v", got)
	}
	if _, err := jsonutil.Marshal(provider.RunSchema("test")); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRunConfiguration(t *testing.T) {
	var validator run.ConfigValidator = New()
	options := func(o RunOptions) jsonv1.RawMessage { data, _ := jsonutil.Marshal(o); return data }
	cases := []struct {
		name   string
		config run.Configuration
		fail   bool
	}{
		{"files ok", run.Configuration{Kind: "files", Files: []string{"main.go"}}, false},
		{"files empty", run.Configuration{Kind: "files"}, true},
		{"files non-go", run.Configuration{Kind: "files", Files: []string{"main.py"}}, true},
		{"bad goos", run.Configuration{Kind: "run", LanguageOptions: options(RunOptions{GOOS: "Win Dows"})}, true},
		{"profile on run", run.Configuration{Kind: "run", LanguageOptions: options(RunOptions{Profile: "cpu"})}, true},
		{"profile on test", run.Configuration{Kind: "test", LanguageOptions: options(RunOptions{Profile: "cpu"})}, false},
		{"broken json", run.Configuration{Kind: "run", LanguageOptions: jsonv1.RawMessage(`{`)}, true},
	}
	for _, tc := range cases {
		if err := validator.ValidateRunConfiguration(tc.config); (err != nil) != tc.fail {
			t.Errorf("%s: err = %v", tc.name, err)
		}
	}
}
