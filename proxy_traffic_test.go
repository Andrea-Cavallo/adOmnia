package main

import "testing"

func TestGlobRewrite(t *testing.T) {
	tests := []struct {
		url, pattern, replacement, want string
	}{
		{"https://api.prod/v1/users", "https://api.prod/*", "https://api.stage/*", "https://api.stage/v1/users"},
		{"https://api.prod/v2/items/123", "https://api.prod/*/items/*", "https://api.stage/*/items/*", "https://api.stage/v2/items/123"},
		{"https://example.com/path", "https://example.com/path", "https://other.com/new", "https://other.com/new"},
		{"https://cdn.prod.com/assets/img/logo.png", "https://cdn.prod.com/*", "https://cdn.stage.com/*", "https://cdn.stage.com/assets/img/logo.png"},
	}
	for _, tt := range tests {
		got := globRewrite(tt.url, tt.pattern, tt.replacement)
		if got != tt.want {
			t.Errorf("globRewrite(%q, %q, %q) = %q, want %q", tt.url, tt.pattern, tt.replacement, got, tt.want)
		}
	}
}
