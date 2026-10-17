package eclipsepde

import "testing"

func TestParseVersion(t *testing.T) {
	tests := []struct {
		in   string
		want Version
		str  string // normalized String()
	}{
		{"1.2.3", Version{1, 2, 3, ""}, "1.2.3"},
		{"2.0.0.qualifier", Version{2, 0, 0, "qualifier"}, "2.0.0.qualifier"},
		{"1", Version{1, 0, 0, ""}, "1.0.0"},
		{"1.2", Version{1, 2, 0, ""}, "1.2.0"},
		{"0.0.0", Version{0, 0, 0, ""}, "0.0.0"},
		// Legacy qualifiers may contain dots: everything after the third part
		// is the qualifier, however many dots it carries.
		{"1.2.3.4.5", Version{1, 2, 3, "4.5"}, "1.2.3.4.5"},
	}
	for _, tt := range tests {
		got, err := ParseVersion(tt.in)
		if err != nil {
			t.Fatalf("ParseVersion(%q): %v", tt.in, err)
		}
		if got != tt.want {
			t.Errorf("ParseVersion(%q) = %+v, want %+v", tt.in, got, tt.want)
		}
		if got.String() != tt.str {
			t.Errorf("ParseVersion(%q).String() = %q, want %q", tt.in, got.String(), tt.str)
		}
	}
	for _, bad := range []string{"", "a.b.c", "1.x"} {
		if _, err := ParseVersion(bad); err == nil {
			t.Errorf("ParseVersion(%q) should fail", bad)
		}
	}
}

func TestVersionCompare(t *testing.T) {
	ordered := []string{"1.0.0", "1.0.1", "1.1.0", "2.0.0", "2.0.0.a", "2.0.0.b", "2.0.1"}
	for i := 0; i < len(ordered)-1; i++ {
		a, _ := ParseVersion(ordered[i])
		b, _ := ParseVersion(ordered[i+1])
		if a.Compare(b) >= 0 {
			t.Errorf("%s should sort before %s", ordered[i], ordered[i+1])
		}
		if b.Compare(a) <= 0 {
			t.Errorf("%s should sort after %s", ordered[i+1], ordered[i])
		}
	}
}

func TestParseVersionRange(t *testing.T) {
	tests := []struct {
		in       string
		match    []string
		noMatch  []string
		strRound bool
	}{
		{"[2.0.0,3.0.0)", []string{"2.0.0", "2.9.9"}, []string{"1.9.9", "3.0.0"}, true},
		{"[2.0.0,3.0.0]", []string{"2.0.0", "3.0.0"}, []string{"1.9.9", "3.0.1"}, true},
		{"(2.0.0,3.0.0)", []string{"2.0.1", "2.9.9"}, []string{"2.0.0", "3.0.0"}, true},
		{"1.2.3", []string{"1.2.3", "9.9.9"}, []string{"1.2.2", "1.0.0"}, true},
		{"[1.2,)", []string{"1.2.0", "5.0.0"}, []string{"1.1.9"}, false},
		{"(,2.0.0]", []string{"0.0.0", "1.0.0", "2.0.0"}, []string{"2.0.1"}, true},
	}
	for _, tt := range tests {
		r, err := ParseVersionRange(tt.in)
		if err != nil {
			t.Fatalf("ParseVersionRange(%q): %v", tt.in, err)
		}
		for _, m := range tt.match {
			v, _ := ParseVersion(m)
			if !r.Match(v) {
				t.Errorf("ParseVersionRange(%q).Match(%s) = false, want true", tt.in, m)
			}
		}
		for _, m := range tt.noMatch {
			v, _ := ParseVersion(m)
			if r.Match(v) {
				t.Errorf("ParseVersionRange(%q).Match(%s) = true, want false", tt.in, m)
			}
		}
		if tt.strRound && r.String() != tt.in {
			t.Errorf("ParseVersionRange(%q).String() = %q", tt.in, r.String())
		}
	}
	for _, bad := range []string{"", "[1.0,2.0", "1.0,2.0)", "[a,b)", "[1.0]"} {
		if _, err := ParseVersionRange(bad); err == nil {
			t.Errorf("ParseVersionRange(%q) should fail", bad)
		}
	}
}
