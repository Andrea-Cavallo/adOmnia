package golang

import "testing"

func TestParseInitTrace(t *testing.T) {
	steps := ParseInitTrace([]string{
		"init internal/bytealg @0.011 ms, 0.004 ms clock, 0 bytes, 0 allocs",
		"listening",
		"init example.com/app/config @1.5 ms, 35 ms clock, 2048 bytes, 12 allocs",
	})
	if len(steps) != 2 || steps[0].Package != "example.com/app/config" || steps[0].ClockMs != 35 || steps[0].Bytes != 2048 {
		t.Fatalf("%+v", steps)
	}
}
