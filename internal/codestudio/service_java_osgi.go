package codestudio

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
)

// p2DownloadTimeout bounds a target download: a full Eclipse SDK target is about 300 MB.
const p2DownloadTimeout = 30 * time.Minute

// osgiDownloads holds the cancel function of the running p2 download of each session.
var osgiDownloads sync.Map

// JavaOsgiWorkspace elenca i bundle OSGi/PDE del progetto e come si risolvono sulla target platform attiva.
func (s *Service) JavaOsgiWorkspace(sessionID string) (*eclipsepde.WorkspaceReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	// Il percorso del target arriva da un file del progetto e porta a leggere fuori dal progetto.
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	return eclipsepde.BuildReport(session.Project.RealPath)
}

// trustedOsgiRoot is the root of an authorized project: the target path comes
// from a project file and leads outside the project.
func (s *Service) trustedOsgiRoot(sessionID string) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return "", errors.New("explicitly authorize the tools for this project")
	}
	return session.Project.RealPath, nil
}

// ReindexJavaOsgiTarget forgets the cached index of the target and reads every manifest again.
func (s *Service) ReindexJavaOsgiTarget(sessionID string) (*eclipsepde.WorkspaceReport, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return nil, err
	}
	return eclipsepde.ReindexReport(root)
}

// PreviewJavaOsgiP2 lists the p2 repositories of the active .target, without network access.
func (s *Service) PreviewJavaOsgiP2(sessionID string) (*eclipsepde.P2Preview, error) {
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return nil, err
	}
	return eclipsepde.PreviewTargetP2(root)
}

// DownloadJavaOsgiP2 downloads the bundles of the p2 locations of the active .target into
// the machine cache, after explicit confirmation. Progress arrives as `osgi.p2.progress`.
func (s *Service) DownloadJavaOsgiP2(sessionID string, confirmed bool) (*eclipsepde.P2DownloadResult, error) {
	if !confirmed {
		return nil, errors.New("explicit confirmation required before downloading the p2 bundles")
	}
	root, err := s.trustedOsgiRoot(sessionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), p2DownloadTimeout)
	defer cancel()
	if _, running := osgiDownloads.LoadOrStore(sessionID, cancel); running {
		return nil, errors.New("the p2 bundles of this project are already downloading")
	}
	defer osgiDownloads.Delete(sessionID)
	return eclipsepde.DownloadTargetP2(ctx, root, func(progress eclipsepde.P2Progress) {
		s.emit("osgi.p2.progress", SessionID(sessionID), sessionID, progress)
	})
}

// CancelJavaOsgiP2 stops the running p2 download of the session, if any.
func (s *Service) CancelJavaOsgiP2(sessionID string) {
	if cancel, ok := osgiDownloads.Load(sessionID); ok {
		cancel.(context.CancelFunc)()
	}
}

// SetJavaOsgiTarget sceglie la target platform (cartella di bundle, installazione Eclipse o file .target).
// Il percorso può stare fuori dal progetto: Kepler di solito è installato altrove.
func (s *Service) SetJavaOsgiTarget(sessionID, path string) (*eclipsepde.WorkspaceReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	return eclipsepde.SetTarget(session.Project.RealPath, path)
}
