package main

import "testing"

func TestIsCLICommand(t *testing.T) {
	cases := map[string]struct {
		args []string
		want bool
	}{
		"desktop":         {[]string{"adomnia.exe"}, false},
		"mcp":             {[]string{"adomnia.exe", "mcp"}, true},
		"run":             {[]string{"adomnia.exe", "run", "dir"}, true},
		"stress":          {[]string{"adomnia.exe", "stress", "plan.json"}, true},
		"lint":            {[]string{"adomnia.exe", "lint"}, true},
		"update hand-off": {[]string{"adomnia.exe", "--adomnia-update-helper", "x"}, false},
	}
	for name, tc := range cases {
		if got := isCLICommand(tc.args); got != tc.want {
			t.Errorf("%s: isCLICommand(%v) = %v, want %v", name, tc.args, got, tc.want)
		}
	}
}
