package codestudio

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"adomnia/internal/languages/java"
)

// javaSettingsFile tiene il JDK scelto per il progetto: Run, Debug e Test lo usano allo stesso modo.
// Sta in .adomnia/ come le run configuration, ma non è condiviso via Git: il percorso è di questa macchina.
const javaSettingsFile = ".adomnia/java.local.json"

type javaSettings struct {
	JavaHome string `json:"javaHome,omitempty"`
}

// JavaJDKReport è ciò che serve a scegliere il JDK: quelli installati, quello che si userebbe senza scelta,
// la scelta corrente e la versione che il progetto dichiara.
type JavaJDKReport struct {
	Installed []java.JDK `json:"installed"`
	Default   java.JDK   `json:"default"`
	Selected  string     `json:"selected"`
	// Required è la versione maggiore più alta dichiarata dalle unità Java (0 = nessuna).
	Required int `json:"required"`
	// Suggested è la home del JDK che soddisfa Required con meno scarto ("" = nessuno lo soddisfa).
	Suggested string `json:"suggested"`
}

func readJavaSettings(root string) javaSettings {
	var settings javaSettings
	if data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(javaSettingsFile))); err == nil {
		_ = json.Unmarshal(data, &settings)
	}
	return settings
}

// projectJavaHome è il JDK scelto per il progetto, "" se non c'è una scelta valida.
func (s *Service) projectJavaHome(sessionID SessionID) string {
	root, err := s.SessionRoot(string(sessionID))
	if err != nil {
		return ""
	}
	if home := readJavaSettings(root).JavaHome; java.ValidJavaHome(home) {
		return home
	}
	return ""
}

// JavaJDKs elenca i JDK installati e la scelta del progetto.
func (s *Service) JavaJDKs(sessionID string) (JavaJDKReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return JavaJDKReport{}, err
	}
	report := JavaJDKReport{Installed: java.DiscoverJDKs(), Default: java.DetectJDK(), Selected: s.projectJavaHome(session.ID)}
	for _, unit := range session.Project.Units {
		if unit.Language == java.ID {
			if required := java.RequiredJava(unit.Root); required > report.Required {
				report.Required = required
			}
		}
	}
	if suggested, ok := java.PickJDK(report.Installed, report.Required); ok {
		report.Suggested = suggested.Home
	}
	return report, nil
}

// SetJavaJDK sceglie il JDK del progetto; una stringa vuota torna al JDK di sistema.
func (s *Service) SetJavaJDK(sessionID, home string) error {
	root, err := s.SessionRoot(sessionID)
	if err != nil {
		return err
	}
	if home != "" && !java.ValidJavaHome(home) {
		return fmt.Errorf("%q is not a JDK folder: it must contain bin/java", home)
	}
	path := filepath.Join(root, filepath.FromSlash(javaSettingsFile))
	if home == "" {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	data, err := json.MarshalIndent(javaSettings{JavaHome: home}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}
