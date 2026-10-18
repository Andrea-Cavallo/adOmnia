package codestudio

import (
	"adomnia/internal/languages/java"
	"fmt"
)

// SpringIndex è tutto ciò che si sa di un progetto Spring senza eseguirlo: proprietà di configurazione
// note, valori scritti con il loro profilo, bean, iniezioni ed endpoint. Lavora solo sul filesystem,
// senza server e senza rete: è l'indice che alimenta completamento e navigazione.
func (s *Service) SpringIndex(sessionID string) (java.SpringIndex, error) {
	root, err := s.SessionRoot(sessionID)
	if err != nil {
		return java.SpringIndex{}, err
	}
	if root == "" {
		return java.SpringIndex{}, fmt.Errorf("session has no project folder")
	}
	return java.BuildSpringIndex(root), nil
}

// SpringMetadataRefresh indicizza i `spring-configuration-metadata.json` degli jar già scaricati
// nella repository Maven locale: è ciò che porta i default e le descrizioni delle liberie nel
// completamento. Nessuna rete, e riprende dalla cache — solo i jar nuovi o cambiati vengono riaperti.
// È un lavoro pesante: parte solo da un'azione esplicita dell'utente.
func (s *Service) SpringMetadataRefresh(sessionID string, limit int) (java.SpringMetadataReport, error) {
	if _, err := s.session(sessionID); err != nil {
		return java.SpringMetadataReport{}, err
	}
	repository := java.DefaultSpringRepository()
	if repository == "" {
		return java.SpringMetadataReport{}, fmt.Errorf("no Maven repository found")
	}
	return java.RefreshSpringMetadata(repository, limit), nil
}

// SpringEndpoints elenca gli endpoint HTTP MVC del progetto, con route, metodo e posizione.
func (s *Service) SpringEndpoints(sessionID string) ([]java.SpringEndpoint, error) {
	index, err := s.SpringIndex(sessionID)
	if err != nil {
		return nil, err
	}
	return index.Endpoints, nil
}

// MyBatisIndex collega i metodi delle interfacce mapper agli statement dei loro XML (e viceversa): solo
// filesystem, senza server né rete.
func (s *Service) MyBatisIndex(sessionID string) (java.MyBatisIndex, error) {
	root, err := s.SessionRoot(sessionID)
	if err != nil {
		return java.MyBatisIndex{}, err
	}
	if root == "" {
		return java.MyBatisIndex{}, fmt.Errorf("session has no project folder")
	}
	return java.BuildMyBatisIndex(root), nil
}
