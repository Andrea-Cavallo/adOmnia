package codestudio

import "testing"

func TestValidJavaClassName(t *testing.T) {
	for name, want := range map[string]bool{
		"it.acme.App": true, "App": true, "it.acme.Outer$Inner": true,
		"": false, "it..App": false, "1bad.App": false, "a b": false, "it.acme.App;rm": false, "-Dx=y": false,
	} {
		if got := validJavaClassName(name); got != want {
			t.Errorf("validJavaClassName(%q) = %v, want %v", name, got, want)
		}
	}
}
