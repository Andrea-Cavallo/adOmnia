package eclipsepde

import (
	"adomnia/internal/jsonutil"
	"encoding/json/v2"
	"strings"
	"testing"
)

func TestBridgeRequestResponseRoundTrip(t *testing.T) {
	params := ResolveParams{
		Workspace:            map[string]string{"it.company.core": "Bundle-SymbolicName: it.company.core\n"},
		TargetPath:           "C:/development/eclipse-target",
		ExecutionEnvironment: "JavaSE-1.6",
	}
	line, err := EncodeBridgeRequest("req-1", BridgeResolve, params)
	if err != nil {
		t.Fatal(err)
	}
	var request BridgeRequest
	if err := json.Unmarshal(line, &request); err != nil {
		t.Fatal(err)
	}
	if request.ID != "req-1" || request.Method != BridgeResolve {
		t.Errorf("request = %+v", request)
	}

	// The bridge answers with a normalized ResolveResult.
	result := ResolveResult{
		Bundles: []ResolvedBundle{{
			SymbolicName: "it.company.core", Version: "2.1.0", State: "RESOLVED",
			Wiring: []Wire{{Kind: "Require-Bundle", Name: "it.company.base", Provider: "it.company.base", ProviderVersion: "1.0.0"}},
		}},
		ToolVersions: map[string]string{"pde": "3.9.0"},
	}
	payload, err := jsonutil.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	responseLine, err := jsonutil.Marshal(BridgeResponse{ID: "req-1", Result: payload})
	if err != nil {
		t.Fatal(err)
	}
	var out ResolveResult
	if err := DecodeBridgeResponse(responseLine, "req-1", &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Bundles) != 1 || out.Bundles[0].State != "RESOLVED" {
		t.Errorf("out = %+v", out)
	}
	if out.ToolVersions["pde"] != "3.9.0" {
		t.Errorf("toolVersions = %v", out.ToolVersions)
	}
}

func TestDecodeBridgeResponseErrors(t *testing.T) {
	// Wrong id.
	if err := DecodeBridgeResponse([]byte(`{"id":"other","result":{}}`), "req-1", nil); err == nil {
		t.Error("expected id mismatch error")
	}
	// Bridge-reported failure.
	err := DecodeBridgeResponse([]byte(`{"id":"req-1","error":"PDE not found"}`), "req-1", nil)
	if err == nil || !strings.Contains(err.Error(), "PDE not found") {
		t.Errorf("error = %v", err)
	}
	// Malformed line.
	if err := DecodeBridgeResponse([]byte("not json"), "req-1", nil); err == nil {
		t.Error("expected malformed error")
	}
	// Malformed result payload.
	if err := DecodeBridgeResponse([]byte(`{"id":"req-1","result":"oops"}`), "req-1", &ResolveResult{}); err == nil {
		t.Error("expected malformed result error")
	}
}

func TestEncodeBridgeRequestWithoutParams(t *testing.T) {
	line, err := EncodeBridgeRequest("ping-1", BridgePing, nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(line), "params") {
		t.Errorf("nil params should be omitted: %s", line)
	}
}
