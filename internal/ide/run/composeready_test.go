package run

import (
	"strings"
	"testing"
)

func TestParseComposePSBothFormats(t *testing.T) {
	array := `[{"Service":"db","State":"running","Health":"healthy"},{"Service":"cache","State":"running","Health":""}]`
	lines := "{\"Service\":\"db\",\"State\":\"running\",\"Health\":\"starting\"}\n{\"Service\":\"init\",\"State\":\"exited\",\"ExitCode\":0}\n"
	for name, input := range map[string]string{"array": array, "ndjson": lines} {
		got, err := parseComposePS([]byte(input))
		if err != nil || len(got) != 2 {
			t.Fatalf("%s: got %v, %v", name, got, err)
		}
	}
	if got, err := parseComposePS([]byte("  \n")); err != nil || got != nil {
		t.Fatalf("empty output: %v %v", got, err)
	}
}

func TestComposeReadiness(t *testing.T) {
	cases := []struct {
		name       string
		containers []composeContainer
		ready      bool
		waiting    string
		failed     string
	}{
		{name: "no containers yet", containers: nil},
		{name: "healthy, no healthcheck and finished init", ready: true, containers: []composeContainer{
			{Service: "db", State: "running", Health: "healthy"}, {Service: "cache", State: "running"}, {Service: "init", State: "exited"},
		}},
		{name: "still starting", waiting: "db (starting), queue (created)", containers: []composeContainer{
			{Service: "queue", State: "created"}, {Service: "db", State: "running", Health: "starting"},
		}},
		{name: "unhealthy", failed: "db is unhealthy", containers: []composeContainer{{Service: "db", State: "running", Health: "unhealthy"}}},
		{name: "crashed", failed: "api exited with code 2", containers: []composeContainer{{Service: "api", State: "exited", ExitCode: 2}}},
	}
	for _, tc := range cases {
		ready, waiting, failed := composeReadiness(tc.containers)
		if ready != tc.ready || strings.Join(waiting, ", ") != tc.waiting || failed != tc.failed {
			t.Errorf("%s: got ready=%v waiting=%q failed=%q", tc.name, ready, strings.Join(waiting, ", "), failed)
		}
	}
}
