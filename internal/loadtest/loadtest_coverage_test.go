package loadtest

import "testing"

func TestGrpcStatusCode(t *testing.T) {
	codes := map[string]int{"OK": 0, "CANCELLED": 1, "UNKNOWN": 2, "INVALID_ARGUMENT": 3, "DEADLINE_EXCEEDED": 4, "NOT_FOUND": 5, "ALREADY_EXISTS": 6, "PERMISSION_DENIED": 7, "RESOURCE_EXHAUSTED": 8, "FAILED_PRECONDITION": 9, "ABORTED": 10, "OUT_OF_RANGE": 11, "UNIMPLEMENTED": 12, "INTERNAL": 13, "UNAVAILABLE": 14, "DATA_LOSS": 15, "UNAUTHENTICATED": 16}
	for status, want := range codes {
		if got := grpcStatusCode(status); got != want {
			t.Errorf("grpcStatusCode(%q) = %d, want %d", status, got, want)
		}
	}
	// gRPC-Go spells codes NotFound, the spec NOT_FOUND: both are the same code.
	for status, want := range map[string]int{"NotFound": 5, "ok": 0, "DeadlineExceeded": 4} {
		if got := grpcStatusCode(status); got != want {
			t.Errorf("grpcStatusCode(%q) = %d, want %d", status, got, want)
		}
	}
	for _, unknown := range []string{"TRANSPORT_ERROR", "HTTP_503", ""} {
		if got := grpcStatusCode(unknown); got != -1 {
			t.Errorf("grpcStatusCode(%q) = %d, want -1", unknown, got)
		}
	}
}
