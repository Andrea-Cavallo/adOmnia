package goide

import "testing"

func TestWithSharedEnvironment(t *testing.T) {
	s := &Service{}
	own := map[string]string{"PORT": "9000"}
	if got := s.withSharedEnvironment(own); len(got) != 1 || got["PORT"] != "9000" {
		t.Fatalf("no shared env must leave the run untouched, got %v", got)
	}

	s.SetSharedEnvironment(map[string]string{"DB_URL": "postgres://db", "PORT": "8080", "base url": "skipped"})
	got := s.withSharedEnvironment(map[string]string{"PORT": "9000", "DSN": "{{ DB_URL }}?x=1", "MISSING": "{{nope}}"})
	want := map[string]string{"DB_URL": "postgres://db", "PORT": "9000", "DSN": "postgres://db?x=1", "MISSING": "{{nope}}"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for key, value := range want {
		if got[key] != value {
			t.Fatalf("%s = %q, want %q", key, got[key], value)
		}
	}
}
