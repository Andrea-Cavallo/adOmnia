// Package loadtest is adOmnia's load testing engine: Run and Manager (virtual users, arrival
// rate, probes, stages, HDR latency histograms, live progress and gates), the targets (a
// resolved request, a Flow Builder graph, a gRPC call), the scenario files, the run history,
// comparisons and reports. The app reaches it through the LoadTest Wails service, CI through
// `adomnia stress`. Plan: mds/LOAD-TESTING.md.
package loadtest

import "strings"

// grpcCodeNames are the gRPC status codes by number, spelled as the spec does.
var grpcCodeNames = []string{"OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND", "ALREADY_EXISTS", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED"}

// grpcStatusCode is the number of a status name, -1 when unknown. gRPC-Go names codes NotFound,
// the spec NOT_FOUND: compare without case or "_".
func grpcStatusCode(status string) int {
	status = strings.ToUpper(strings.ReplaceAll(status, "_", ""))
	for code, name := range grpcCodeNames {
		if strings.ReplaceAll(name, "_", "") == status {
			return code
		}
	}
	return -1
}
