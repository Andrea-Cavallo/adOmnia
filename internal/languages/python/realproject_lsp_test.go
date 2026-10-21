package python

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestRealProjectThirdPartyImportsFollowTheSelectedEnvironment riproduce sul progetto reale la
// segnalazione del 2026-10-21 ("gtts/psutil could not be resolved"). Il progetto si apre in sola
// lettura (ADOMNIA_TEST_PYTHON_REAL_PROJECT = la sua cartella; niente viene scritto lì):
//
//   - con un interprete che NON ha i pacchetti — quello che il progetto risolve oggi, senza venv —
//     gli import di terze parti restano irrisolti, esattamente ciò che vede l'utente;
//   - con un interprete che li ha (ambiente con i moduli), gli stessi file non hanno più alcuna
//     diagnostica di import irrisolto.
//
// È la prova che il meccanismo `python.pythonPath` dell'IDE funziona e che la causa è
// l'ambiente selezionato, non il language server. Serve basedpyright (ADOMNIA_TEST_PYTHON).
func TestRealProjectThirdPartyImportsFollowTheSelectedEnvironment(t *testing.T) {
	project := os.Getenv("ADOMNIA_TEST_PYTHON_REAL_PROJECT")
	if project == "" {
		t.Skip("set ADOMNIA_TEST_PYTHON_REAL_PROJECT to a real Python project to run this check")
	}
	for _, name := range []string{
		filepath.Join("projects", "Text_to_speech", "txtToSpeech.py"),
		filepath.Join("projects", "Battery_notification", "battery.py"),
	} {
		if _, err := os.Stat(filepath.Join(project, name)); err != nil {
			t.Fatalf("the real project does not look like the expected one: %v", err)
		}
	}
	interpreter := testInterpreterWith(t, "basedpyright")

	// Gli import da controllare: il progetto dichiara questi pacchetti in requirementsALL.txt.
	missing := []string{"gtts", "psutil", "pynotifier"}
	documents := map[string]string{}
	for _, name := range []string{
		filepath.Join("projects", "Text_to_speech", "txtToSpeech.py"),
		filepath.Join("projects", "Battery_notification", "battery.py"),
	} {
		data, err := os.ReadFile(filepath.Join(project, name))
		if err != nil {
			t.Fatal(err)
		}
		documents[filepath.Join(project, name)] = string(data)
	}

	t.Run("without the packages the imports stay unresolved", func(t *testing.T) {
		bare := t.TempDir()
		createEnvironment(t, interpreter, bare, "bare")
		settings := pythonSettingsFor(t, environmentInterpreter(filepath.Join(bare, "venv")))
		conn, handler, _ := openProjectLangserver(t, project)
		initializeProject(t, conn, handler, project, settings, documents)
		messages := diagnosticMessages(t, handler, 3*time.Second, 90*time.Second)
		for _, name := range missing {
			if !unresolvedImport(messages, name) {
				t.Fatalf("expected %q to be unresolved without the package, got: %v", name, messages)
			}
		}
	})

	t.Run("with the packages the same files resolve", func(t *testing.T) {
		full := t.TempDir()
		createEnvironment(t, interpreter, full, "full")
		site := sitePackages(t, filepath.Join(full, "venv"))
		writeFile(t, site, "gtts/__init__.py", "class gTTS:\n    def __init__(self, text: str = \"\", lang: str = \"en\", slow: bool = False) -> None: ...\n    def save(self, path: str) -> None: ...\n")
		writeFile(t, site, "psutil/__init__.py", "class Battery:\n    power_plugged: bool\n    percent: float\n\ndef sensors_battery() -> Battery | None: ...\n")
		writeFile(t, site, "pynotifier/__init__.py", "class Notification:\n    def __init__(self, title: str = \"\", description: str = \"\", duration: int = 0) -> None: ...\n    def send(self) -> None: ...\n")
		settings := pythonSettingsFor(t, environmentInterpreter(filepath.Join(full, "venv")))
		conn, handler, _ := openProjectLangserver(t, project)
		initializeProject(t, conn, handler, project, settings, documents)
		messages := diagnosticMessages(t, handler, 3*time.Second, 90*time.Second)
		for _, name := range missing {
			if unresolvedImport(messages, name) {
				t.Fatalf("%q must resolve when the selected environment has it: %v", name, messages)
			}
		}
	})

	t.Run("the project's own environment is what the IDE resolves", func(t *testing.T) {
		environment := environmentInterpreter(filepath.Join(project, ".venv"))
		if environment == "" {
			t.Skip("the real project has no .venv: create one and install its requirements")
		}
		// La scelta salvata (o almeno l'ambiente del progetto) deve portare a questo interprete.
		resolved, err := ResolveInterpreter(project, project, "")
		if err != nil || resolved.Path != filepath.Clean(environment) {
			t.Fatalf("the IDE does not resolve the project environment: %+v %v", resolved, err)
		}
		conn, handler, _ := openProjectLangserver(t, project)
		initializeProject(t, conn, handler, project, pythonSettingsFor(t, environment), documents)
		messages := diagnosticMessages(t, handler, 3*time.Second, 90*time.Second)
		for _, name := range missing {
			if unresolvedImport(messages, name) {
				t.Fatalf("%q must resolve in the project .venv: %v", name, messages)
			}
		}
	})
}

// pythonSettingsFor sono le impostazioni LSP dell'IDE con l'interprete indicato come scelta.
func pythonSettingsFor(t *testing.T, interpreter string) map[string]any {
	t.Helper()
	if interpreter == "" {
		t.Fatal("the environment has no interpreter")
	}
	return map[string]any{
		"python":       map[string]any{"pythonPath": interpreter},
		"basedpyright": map[string]any{"analysis": map[string]any{"diagnosticMode": "openFilesOnly"}},
	}
}
