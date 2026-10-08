package main

import "testing"

func TestCompareSemver(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v0.4.2", "v0.4.1", 1},
		{"v0.4.1", "v0.4.2", -1},
		{"v0.4.2", "v0.4.2", 0},
		{"0.4.2", "v0.4.2", 0},   // missing "v" prefix
		{"v0.5.0", "v0.4.9", 1},  // minor beats patch
		{"v1.0.0", "v0.9.9", 1},  // major beats all
		{"v0.4.2-rc1", "v0.4.2", 0}, // pre-release suffix ignored
		{"v0.4.10", "v0.4.9", 1}, // numeric, not lexical
	}
	for _, c := range cases {
		if got := compareSemver(c.a, c.b); got != c.want {
			t.Errorf("compareSemver(%q,%q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}
