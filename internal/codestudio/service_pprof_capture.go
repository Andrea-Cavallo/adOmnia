package codestudio

import (
	"context"
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

// CaptureLiveProfile scarica un profilo da /debug/pprof di un servizio locale, verifica che sia pprof
// valido e lo salva nella radice del progetto, pronto per il Performance Studio.
func (s *Service) CaptureLiveProfile(ctx context.Context, request LiveProfileRequest) (ProfileFile, error) {
	session, err := s.session(request.SessionID)
	if err != nil {
		return ProfileFile{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return ProfileFile{}, fmt.Errorf("authorize the project before saving profiles inside it")
	}
	return golang.CaptureLiveProfile(ctx, session.Project.RealPath, request)
}
