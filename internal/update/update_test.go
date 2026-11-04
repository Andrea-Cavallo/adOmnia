package update

import "testing"

func TestCompareSemver(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v0.4.2", "v0.4.1", 1},
		{"v0.4.1", "v0.4.2", -1},
		{"v0.4.2", "v0.4.2", 0},
		{"0.4.2", "v0.4.2", 0},  // missing "v" prefix
		{"v0.5.0", "v0.4.9", 1}, // minor beats patch
		{"v1.0.0", "v0.9.9", 1}, // major beats all
		{"v0.4.2-rc1", "v0.4.2", -1},
		{"v0.10.0-beta.10", "v0.10.0-beta.2", 1},
		{"v0.10.0", "v0.10.0-beta.2", 1},
		{"v0.4.10", "v0.4.9", 1}, // numeric, not lexical
	}
	for _, c := range cases {
		if got := CompareSemver(c.a, c.b); got != c.want {
			t.Errorf("CompareSemver(%q,%q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

// A mistyped tag published after the real release (v0.1.24 after v1.0.24) is
// GitHub's "Latest", but the newest version is still v1.0.24.
func TestNewestStableReleaseIgnoresPublicationOrder(t *testing.T) {
	releases := []release{
		{Tag: "v0.1.24"},
		{Tag: "v1.0.24", URL: "https://github.com/Andrea-Cavallo/adOmnia/releases/tag/v1.0.24"},
		{Tag: "v1.1.0-beta.1", Prerelease: true},
		{Tag: "v1.2.0", Draft: true},
		{Tag: "v1.0.23"},
		{Tag: "not-a-version"},
	}
	newest := newestStableRelease(releases)
	if newest == nil || newest.Tag != "v1.0.24" {
		t.Fatalf("newest = %+v", newest)
	}
	if newestStableRelease([]release{{Tag: "v2.0.0-rc.1"}, {Draft: true, Tag: "v2.0.0"}}) != nil {
		t.Fatal("drafts and prereleases are never the newest stable release")
	}
}
