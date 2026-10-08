package main

import "testing"

func TestStartupWindowChromeDefaultsToAppTitlebar(t *testing.T) {
	cases := []struct {
		name, settings, goos, want string
	}{
		{"no settings on Windows", ``, "windows", windowChromeApp},
		{"no settings on Linux", ``, "linux", windowChromeSystem},
		{"pre-v13 system migrates", `{"version":11,"appearance":{"windowChrome":"system"}}`, "windows", windowChromeApp},
		{"pre-v13 system kept on Linux", `{"version":11,"appearance":{"windowChrome":"system"}}`, "linux", windowChromeSystem},
		{"v12 system migrates once more", `{"version":12,"appearance":{"windowChrome":"system"}}`, "windows", windowChromeApp},
		{"explicit system after v13 is kept", `{"version":13,"appearance":{"windowChrome":"system"}}`, "windows", windowChromeSystem},
		{"explicit app kept", `{"version":12,"appearance":{"windowChrome":"app"}}`, "darwin", windowChromeApp},
	}
	for _, c := range cases {
		if got := startupWindowChromeFromSettings([]byte(c.settings), c.goos); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
