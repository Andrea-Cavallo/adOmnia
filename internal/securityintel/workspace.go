package securityintel

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"os"
	"path/filepath"
	"sort"
)

// WorkspaceSettingsFile è il file di configurazione della Security Intelligence dentro
// il progetto. È versionabile con il repository: le decisioni di soppressione
// (chi ha accettato un rischio, perché, fino a quando) devono stare con il codice che
// le eredita, non in un database locale di chi le ha prese.
//
// Non è .adomnia/security.json: quello è il baseline dello scan di codice.
const WorkspaceSettingsFile = ".adomnia/dependency-security.json"

// workspaceSettingsVersion è la versione dello schema del file di configurazione.
const workspaceSettingsVersion = "1.0"

// WorkspaceSettings è la configurazione di sicurezza delle dipendenze di un progetto.
type WorkspaceSettings struct {
	Version string `json:"version"`
	// Suppressions sono le vulnerabilità accettate, con motivazione e scadenza.
	Suppressions []Suppression `json:"suppressions,omitempty"`
	// EcosystemsLimita la scansione a certi ecosistemi. Vuoto: tutti.
	Ecosystems []Ecosystem `json:"ecosystems,omitempty"`
	// IncludePluginDependencies aggiunge le dipendenze dei plugin di build.
	IncludePluginDependencies bool `json:"includePluginDependencies,omitzero"`
	// IncludeOptional considera anche le dipendenze opzionali.
	IncludeOptional bool `json:"includeOptional,omitzero"`
	// OfflineForza l'analisi offline: nessuna richiesta ai database di advisory.
	Offline bool `json:"offline,omitzero"`
	// Sources sostituisce gli endpoint delle fonti con specchi aziendali.
	SourceEndpoints map[string]string `json:"sourceEndpoints,omitempty"`
}

// LoadWorkspaceSettings legge la configurazione di sicurezza di un progetto.
// Un file assente equivale a impostazioni vuote, mai a un errore.
func LoadWorkspaceSettings(root string) (WorkspaceSettings, error) {
	settings := WorkspaceSettings{Version: workspaceSettingsVersion}
	data, err := os.ReadFile(WorkspaceSettingsPath(root))
	if err != nil {
		if os.IsNotExist(err) {
			return settings, nil
		}
		return settings, err
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return WorkspaceSettings{}, fmt.Errorf("%s is not valid JSON: %w", WorkspaceSettingsFile, err)
	}
	if settings.Version == "" {
		settings.Version = workspaceSettingsVersion
	}
	return settings, nil
}

// SaveWorkspaceSettings scrive la configurazione di sicurezza di un progetto.
func SaveWorkspaceSettings(root string, settings WorkspaceSettings) error {
	if settings.Version == "" {
		settings.Version = workspaceSettingsVersion
	}
	sort.SliceStable(settings.Suppressions, func(left, right int) bool {
		if settings.Suppressions[left].Component != settings.Suppressions[right].Component {
			return settings.Suppressions[left].Component < settings.Suppressions[right].Component
		}
		return settings.Suppressions[left].Reason < settings.Suppressions[right].Reason
	})
	data, err := jsonutil.Marshal(settings, jsontext.WithIndent("  "))
	if err != nil {
		return err
	}
	path := WorkspaceSettingsPath(root)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("%s folder is not writable: %w", filepath.Dir(path), err)
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// WorkspaceSettingsPath è il percorso del file di configurazione di sicurezza.
func WorkspaceSettingsPath(root string) string {
	return filepath.Join(root, filepath.FromSlash(WorkspaceSettingsFile))
}

// UpsertSuppression aggiunge o sostituisce una soppressione. Una soppressione senza
// motivazione viene rifiutata: un'ignoranza senza ragione è una rimozione silenziosa.
func (s *WorkspaceSettings) UpsertSuppression(suppression Suppression) error {
	if suppression.Reason == "" {
		return fmt.Errorf("a suppression needs a written reason")
	}
	if suppression.Component == "" && len(suppression.AdvisoryIDs) == 0 {
		return fmt.Errorf("a suppression must name the advisories or the component it covers")
	}
	for index := range s.Suppressions {
		existing := &s.Suppressions[index]
		if existing.Component != suppression.Component {
			continue
		}
		if sameAdvisorySet(existing.AdvisoryIDs, suppression.AdvisoryIDs) {
			s.Suppressions[index] = suppression
			return nil
		}
	}
	s.Suppressions = append(s.Suppressions, suppression)
	return nil
}

// RemoveSuppression toglie la soppressione di un advisory, per qualunque componente.
func (s *WorkspaceSettings) RemoveSuppression(advisoryID string) bool {
	kept := s.Suppressions[:0]
	removed := false
	for _, suppression := range s.Suppressions {
		if containsString(suppression.AdvisoryIDs, advisoryID) {
			removed = true
			continue
		}
		kept = append(kept, suppression)
	}
	s.Suppressions = kept
	return removed
}

// sameAdvisorySet dice se due elenchi di advisory contengono gli stessi identificativi.
func sameAdvisorySet(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for _, value := range left {
		if !containsString(right, value) {
			return false
		}
	}
	return true
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
