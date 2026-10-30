package milk

import (
	"encoding/json/v2"
	"testing"
)

func TestCapabilityFlagAcceptsBoolAndObject(t *testing.T) {
	for input, want := range map[string]bool{`{"close":true}`: true, `{"close":{}}`: true, `{"close":false}`: false, `{"close":null}`: false, `{}`: false} {
		var got struct {
			Close capabilityFlag `json:"close"`
		}
		if err := json.Unmarshal([]byte(input), &got); err != nil || bool(got.Close) != want {
			t.Errorf("%s: got %v err %v, want %v", input, got.Close, err, want)
		}
	}
}
