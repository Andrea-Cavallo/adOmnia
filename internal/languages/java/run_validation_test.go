package java

import (
	"encoding/json"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"testing"
)

func TestRunConfigurationValidationWithoutLaunchingTools(t *testing.T) {
	var validator run.ConfigValidator = New()
	for _, tc := range []struct {
		kind, options string
		valid         bool
	}{
		{KindMain, `{"mainClass":"it.acme.App","vmOptions":["-Xmx512m"]}`, true},
		{KindMain, `{"mainClass":"bad class"}`, false},
		{KindMain, `{"mainClass":"App","vmOptions":["not-a-flag"]}`, false},
		{KindAttach, `{"host":"127.0.0.1","port":"5005"}`, true},
		{KindAttach, `{"port":"70000"}`, false},
		{KindAttach, `{"port":"no"}`, false},
	} {
		err := validator.ValidateRunConfiguration(run.Configuration{Kind: run.Kind(tc.kind), LanguageOptions: json.RawMessage(tc.options)})
		if (err == nil) != tc.valid {
			t.Errorf("kind=%s options=%s: %v", tc.kind, tc.options, err)
		}
	}
}
