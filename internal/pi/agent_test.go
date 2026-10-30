package pi

import (
	"slices"
	"testing"
)

func TestEnvironmentAliasesMimoKey(t *testing.T) {
	t.Setenv("XIAOMI_API_KEY", "")
	t.Setenv("MIMO_API_KEY", "k")
	if !slices.Contains(environment(nil), "XIAOMI_API_KEY=k") {
		t.Fatal("MIMO_API_KEY should be exposed to Pi as XIAOMI_API_KEY")
	}
	if slices.Contains(environment(map[string]string{"XIAOMI_API_KEY": "own"}), "XIAOMI_API_KEY=k") {
		t.Fatal("an explicit XIAOMI_API_KEY must win")
	}
}
