package run

import "testing"

func TestNormalizeComposeDownFlags(t *testing.T) {
	if got, err := NormalizeComposeArguments([]string{"down", "--remove-orphans", "--volumes"}); err != nil || len(got) != 3 {
		t.Fatalf("down flags = %v, %v", got, err)
	}
	for _, bad := range [][]string{{"down", "db"}, {"down", "--rmi=all"}, {"exec", "db"}} {
		if _, err := NormalizeComposeArguments(bad); err == nil {
			t.Fatalf("%v accepted", bad)
		}
	}
}
