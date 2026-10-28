package golang

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/exp/trace"
)

// CaptureLiveTrace records /debug/pprof/trace of a local service for a few seconds, checks it is a Go trace
// and saves it in the project root.
func CaptureLiveTrace(ctx context.Context, root string, request LiveProfileRequest) (ProfileFile, error) {
	request.Kind = "trace"
	endpoint, timeout, err := liveProfileEndpoint(request)
	if err != nil {
		return ProfileFile{}, err
	}
	data, err := fetchLiveProfile(ctx, endpoint, timeout)
	if err != nil {
		return ProfileFile{}, err
	}
	if _, err := trace.NewReader(bytes.NewReader(data)); err != nil {
		return ProfileFile{}, fmt.Errorf("the response from %s is not a Go trace: %w", endpoint, err)
	}
	name := fmt.Sprintf("trace-%s.out", time.Now().Format("20060102-150405"))
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return ProfileFile{}, fmt.Errorf("saving the trace failed: %w", err)
	}
	return ProfileFile{Path: path, Relative: name, Name: name, Kind: "trace", Size: int64(len(data)), Modified: time.Now().UTC().Format(time.RFC3339)}, nil
}
