package main

import (
	"slices"
	"testing"
)

func TestWebviewNetworkFlags(t *testing.T) {
	t.Setenv("ADOMNIA_WEBVIEW2_ARGS", "")
	args := webviewBrowserArgs()
	for _, flag := range []string{"--disable-background-networking", "--disable-component-update", "--js-flags=--max-old-space-size=512"} {
		if !slices.Contains(args, flag) {
			t.Fatalf("missing %s in %v", flag, args)
		}
	}
	if slices.Contains(args, "--in-process-gpu") {
		t.Fatal("GPU isolation must stay enabled")
	}
	t.Setenv("ADOMNIA_WEBVIEW2_ARGS", "--remote-debugging-port=19402 --example")
	extra := webviewBrowserArgs()
	if !slices.Contains(extra, "--remote-debugging-port=19402") || !slices.Contains(extra, "--example") {
		t.Fatalf("development flags lost: %v", extra)
	}
}
