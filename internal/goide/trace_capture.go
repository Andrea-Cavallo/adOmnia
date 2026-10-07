package goide

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/exp/trace"
)

// CaptureLiveTrace registra per qualche secondo /debug/pprof/trace di un servizio su questa macchina
// (anche un pod o un host remoto raggiunto con un port forward su 127.0.0.1), verifica che sia una trace
// Go leggibile e la salva nel progetto, pronta per il Trace viewer.
func (s *Service) CaptureLiveTrace(ctx context.Context, request LiveProfileRequest) (ProfileFile, error) {
	session, err := s.session(request.SessionID)
	if err != nil {
		return ProfileFile{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return ProfileFile{}, fmt.Errorf("autorizza il progetto prima di salvare tracce al suo interno")
	}
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
		return ProfileFile{}, fmt.Errorf("la risposta di %s non è una trace Go: %w", endpoint, err)
	}
	name := fmt.Sprintf("trace-%s.out", time.Now().Format("20060102-150405"))
	path := filepath.Join(session.Project.RealPath, name)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return ProfileFile{}, fmt.Errorf("salvataggio della trace fallito: %w", err)
	}
	return ProfileFile{Path: path, Relative: name, Name: name, Kind: "trace", Size: int64(len(data)), Modified: time.Now().UTC().Format(time.RFC3339)}, nil
}
