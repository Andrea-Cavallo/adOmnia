package codestudio

import (
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// JavaJFRRecording è una registrazione avviata da adOmnia: il nome serve a fermarla, il file è dove finisce.
type JavaJFRRecording struct {
	Name string `json:"name"`
	File string `json:"file"`
}

// JavaJVMs elenca le JVM locali dell'utente (jcmd -l), con il JDK scelto per il progetto.
func (s *Service) JavaJVMs(sessionID string) ([]java.JVMProcess, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	return java.ListJVMs(s.projectJavaHome(session.ID))
}

// JavaJVMSample campiona memoria e GC di una JVM (jstat -gc): solo lettura, su richiesta.
func (s *Service) JavaJVMSample(sessionID string, pid int) (java.JVMHeapSample, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return java.JVMHeapSample{}, err
	}
	return java.SampleJVM(s.projectJavaHome(session.ID), pid)
}

// JavaStartJFR avvia una registrazione JFR su una JVM locale. Cambia lo stato di un altro processo: il progetto
// deve essere autorizzato.
func (s *Service) JavaStartJFR(sessionID string, pid int) (JavaJFRRecording, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return JavaJFRRecording{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return JavaJFRRecording{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	name, file, err := java.StartJFR(s.projectJavaHome(session.ID), pid)
	return JavaJFRRecording{Name: name, File: file}, err
}

// JavaStopJFR ferma la registrazione: il file indicato da JavaStartJFR è completo solo dopo.
func (s *Service) JavaStopJFR(sessionID string, pid int, name string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return fmt.Errorf("explicitly authorize the tools for this project")
	}
	return java.StopJFR(s.projectJavaHome(session.ID), pid, name)
}
