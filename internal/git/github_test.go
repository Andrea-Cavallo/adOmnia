package git

import "testing"

func TestParseGitHubOwnerRepo(t *testing.T) {
	cases := []struct {
		base, owner, repo string
		wantErr           bool
	}{
		{"https://github.com/Andrea-Cavallo/adOmnia", "Andrea-Cavallo", "adOmnia", false},
		{"https://github.com/owner/repo/", "owner", "repo", false},
		{"https://gitlab.com/owner/repo", "", "", true},
		{"https://github.com/owner", "", "", true},
		{"", "", "", true},
	}
	for _, c := range cases {
		owner, repo, err := parseGitHubOwnerRepo(c.base)
		if (err != nil) != c.wantErr {
			t.Fatalf("%q: err=%v wantErr=%v", c.base, err, c.wantErr)
		}
		if !c.wantErr && (owner != c.owner || repo != c.repo) {
			t.Fatalf("%q: got %s/%s want %s/%s", c.base, owner, repo, c.owner, c.repo)
		}
	}
}
