package loadtest

import "testing"

func TestGrpcLoadTestOutcomeUsesGrpcStatus(t *testing.T) {
	if ok, status := grpcLoadTestOutcome(200, []byte(`{"status":"UNAVAILABLE","error":"down"}`)); ok || status != "UNAVAILABLE" {
		t.Fatalf("ok=%v status=%s", ok, status)
	}
	if ok, status := grpcLoadTestOutcome(200, []byte(`{"status":"OK"}`)); !ok || status != "OK" {
		t.Fatalf("ok=%v status=%s", ok, status)
	}
	if ok, status := grpcLoadTestOutcome(502, nil); ok || status != "HTTP_502" {
		t.Fatalf("ok=%v status=%s", ok, status)
	}
}
