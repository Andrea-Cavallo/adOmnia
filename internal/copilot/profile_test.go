package copilot

import "testing"

func TestNormalizeHostAndType(t *testing.T) {
	cases := []struct {
		raw, host string
		kind      ProfileType
	}{
		{"github.com", "github.com", ProfileDotCom},
		{"https://GitHub.com/", "github.com", ProfileDotCom},
		{"company.ghe.com", "company.ghe.com", ProfileEnterpriseCloud},
		{" https://Company.GHE.com ", "company.ghe.com", ProfileEnterpriseCloud},
		{"github.company.internal", "github.company.internal", ProfileEnterpriseServer},
		{"https://git.corp.example:8443", "git.corp.example:8443", ProfileEnterpriseServer},
	}
	for _, c := range cases {
		host, err := NormalizeHost(c.raw)
		if err != nil {
			t.Fatalf("%q: %v", c.raw, err)
		}
		if host != c.host {
			t.Fatalf("%q: host %q, want %q", c.raw, host, c.host)
		}
		if kind := DetectProfileType(host); kind != c.kind {
			t.Fatalf("%q: type %q, want %q", c.raw, kind, c.kind)
		}
	}
}

func TestNormalizeHostRejectsUnsafeValues(t *testing.T) {
	for _, raw := range []string{"", "http://github.com", "https://user:pw@github.com", "github.com/login", "https://github.com?x=1", "not a host"} {
		if _, err := NormalizeHost(raw); err == nil {
			t.Fatalf("%q: expected an error", raw)
		}
	}
}

func TestEnterpriseURIOnlyForEnterprise(t *testing.T) {
	personal := DefaultProfile()
	if personal.EnterpriseURI() != "" || personal.Enterprise() {
		t.Fatalf("github.com must not be enterprise: %+v", personal)
	}
	work, err := NewProfile("work", "Work", "company.ghe.com")
	if err != nil {
		t.Fatal(err)
	}
	if work.EnterpriseURI() != "https://company.ghe.com" || work.Label() != "Work — company.ghe.com" {
		t.Fatalf("unexpected enterprise profile: %+v", work)
	}
}
