package goide

import "testing"

func TestParseModWhy(t *testing.T) {
	why := ParseModWhy("github.com/x/y", "# github.com/x/y\nexample.com/app\nexample.com/app/store\ngithub.com/x/y\n")
	if !why.Needed || len(why.Chain) != 3 || why.Chain[1] != "example.com/app/store" {
		t.Fatalf("%+v", why)
	}
	unused := ParseModWhy("github.com/old", "# github.com/old\n(main module does not need module github.com/old)\n")
	if unused.Needed || unused.Message != "main module does not need module github.com/old" {
		t.Fatalf("%+v", unused)
	}
}
