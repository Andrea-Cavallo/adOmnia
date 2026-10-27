package main

import "testing"

func TestModuleVersion(t *testing.T) {
	for stamped, want := range map[string]string{
		"":                                      "dev",
		"(devel)":                               "dev",
		"v1.0.18":                               "v1.0.18",
		"v1.0.19-0.20261027180000-2098a785657b": "v1.0.19-0.20261027180000-2098a785657b",
	} {
		if got := moduleVersion(stamped); got != want {
			t.Errorf("moduleVersion(%q) = %q, want %q", stamped, got, want)
		}
	}
}
