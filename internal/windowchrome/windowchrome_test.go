package windowchrome

import "testing"

func TestStartupWindowChromeDefaultsToAppTitlebar(t *testing.T) {
	cases := []struct {
		name, settings, goos, want string
	}{
		{"no settings on Windows", ``, "windows", App},
		{"no settings on Linux", ``, "linux", System},
		{"pre-v13 system migrates", `{"version":11,"appearance":{"windowChrome":"system"}}`, "windows", App},
		{"pre-v13 system kept on Linux", `{"version":11,"appearance":{"windowChrome":"system"}}`, "linux", System},
		{"v12 system migrates once more", `{"version":12,"appearance":{"windowChrome":"system"}}`, "windows", App},
		{"explicit system after v13 is kept", `{"version":13,"appearance":{"windowChrome":"system"}}`, "windows", System},
		{"explicit app kept", `{"version":12,"appearance":{"windowChrome":"app"}}`, "darwin", App},
	}
	for _, c := range cases {
		if got := FromSettings([]byte(c.settings), c.goos); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
