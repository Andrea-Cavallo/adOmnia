package codestudio

import (
	"context"
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
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
		return ProfileFile{}, fmt.Errorf("authorize the project before saving traces inside it")
	}
	return golang.CaptureLiveTrace(ctx, session.Project.RealPath, request)
}
