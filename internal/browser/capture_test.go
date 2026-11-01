package browser

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCapturePageRecordsScreenshotErrorsAndRequests(t *testing.T) {
	if findBrowserExecutable() == "" {
		t.Skip("no Chromium-based browser installed")
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/html")
		_, _ = writer.Write([]byte(`<!doctype html><title>Orders</title><h1>Orders</h1><script>throw new Error("orders failed to render")</script>`))
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	capture, err := CapturePage(ctx, server.URL, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if len(capture.PNG) < 8 || string(capture.PNG[1:4]) != "PNG" {
		t.Fatalf("no PNG screenshot (%d bytes)", len(capture.PNG))
	}
	if capture.Title != "Orders" || len(capture.Errors) == 0 || !strings.Contains(capture.Errors[0], "orders failed to render") {
		t.Fatalf("capture = title %q, errors %v", capture.Title, capture.Errors)
	}
	if len(capture.Requests) == 0 {
		t.Fatal("the page request was not recorded")
	}
}
