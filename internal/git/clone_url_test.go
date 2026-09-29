package git

import "testing"

func TestValidateCloneURLRejectsOptionsAndExoticTransports(t *testing.T) {
	for _, valid := range []string{
		"https://github.com/golang/example.git", "http://gitlab.local/team/app", "ssh://git@host:22/repo.git",
		"git@github.com:golang/example.git", "git://example.org/repo.git",
	} {
		if err := ValidateCloneURL(valid); err != nil {
			t.Errorf("%s rejected: %v", valid, err)
		}
	}
	for _, invalid := range []string{
		"", "--upload-pack=touch /tmp/pwned", "-u evil", "ext::sh -c touch% /tmp/pwned", "file:///etc", "C:\\repo",
		"https://host/repo --upload-pack=x", "../local",
	} {
		if err := ValidateCloneURL(invalid); err == nil {
			t.Errorf("%q accepted", invalid)
		}
	}
}
