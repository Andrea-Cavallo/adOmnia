package httpexec

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestExecuteWithHooksSurfacesPluginFailure(t *testing.T) {
	resultJSON := ExecuteWithHooks(`{"method":"GET","url":"https://example.test","headers":{}}`, func(eventType, payloadJSON string) (string, error) {
		if eventType == "onRequest" {
			return "", errors.New("prepareRequest failed")
		}
		return payloadJSON, nil
	})

	var response HTTPExecResponse
	if err := json.Unmarshal([]byte(resultJSON), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Error == nil || response.Error.Code != "PLUGIN_HOOK_ERR" {
		t.Fatalf("response error = %#v", response.Error)
	}
}
