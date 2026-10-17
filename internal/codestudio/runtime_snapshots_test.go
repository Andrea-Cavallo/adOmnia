package codestudio

import "testing"

func TestRuntimeSnapshotNames(t *testing.T) {
	for _, bad := range []string{"../x.json", "a/b.json", "x.txt", ""} {
		if snapshotName.MatchString(bad) {
			t.Fatalf("%q accepted", bad)
		}
	}
	if !snapshotName.MatchString("20261011-101500-before-deploy.json") {
		t.Fatal("valid name rejected")
	}
}
