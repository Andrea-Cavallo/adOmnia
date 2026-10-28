package codestudio

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Un Procfile diventa una proposta per ogni processo dichiarato, con argv già diviso e senza
// shell quando basta (P2-B "Entry point").
func TestProcfileSuggestionsBecomeRunConfigurations(t *testing.T) {
	root := t.TempDir()
	content := strings.Join([]string{
		"# processes",
		"web: node server.js --port 3000",
		"worker: node worker.js",
		"",
		"broken line without a colon",
		"empty:",
	}, "\n")
	writeFile(t, filepath.Join(root, "Procfile"), content)
	suggestions := procfileSuggestions(root)
	if len(suggestions) != 2 {
		t.Fatalf("suggestions = %+v", suggestions)
	}
	if suggestions[0].ID != "procfile|procfile|web" || suggestions[0].Title != "Procfile · web" {
		t.Fatalf("first suggestion = %+v", suggestions[0])
	}
	config := suggestions[0].Configuration
	if config.Kind != "command" || config.Target != "node" || strings.Join(config.ProgramArguments, " ") != "server.js --port 3000" {
		t.Fatalf("configuration = %+v", config)
	}
	if suggestions[0].Action != "run" || suggestions[0].UnitRoot != root {
		t.Fatalf("suggestion = %+v", suggestions[0])
	}
	// La proposta deve essere salvabile così com'è: passa la stessa normalizzazione della UI.
	draft := RunConfiguration{Kind: RunConfigurationKind(config.Kind), Target: config.Target, ProgramArguments: config.ProgramArguments}
	if _, err := normalizeCommandConfiguration(draft); err != nil {
		t.Fatalf("the proposal is not a valid command configuration: %v", err)
	}
}

// Le virgolette tengono insieme gli argomenti con spazi.
func TestSplitCommandLineKeepsQuotedArguments(t *testing.T) {
	argv, ok := splitCommandLine(`node "my server.js" --title 'hello world'`)
	if !ok || strings.Join(argv, "|") != `node|my server.js|--title|hello world` {
		t.Fatalf("argv = %v ok = %v", argv, ok)
	}
	// Virgolette non bilanciate: non è esprimibile in argv, il chiamante passa dallo shell.
	if _, ok := splitCommandLine(`node "unclosed`); ok {
		t.Fatal("an unbalanced quote must not become argv")
	}
	if _, ok := splitCommandLine("   "); ok {
		t.Fatal("an empty command must not become argv")
	}
}

// Un comando che dipende dallo shell ($PORT, pipe, &&) conserva la riga originale ed è eseguito
// dallo shell del sistema: la stessa scelta degli script .bat/.cmd. `sh` è preferito quando esiste.
func TestProcfileCommandNeedingAShellUsesIt(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "Procfile"), "web: uvicorn app:app --port $PORT\nworker: rake jobs:work && echo done\n")
	suggestions := procfileSuggestions(root)
	if len(suggestions) != 2 {
		t.Fatalf("suggestions = %+v", suggestions)
	}
	web := suggestions[0].Configuration
	// La scelta dipende dallo shell disponibile sulla macchina: si confronta con la stessa logica.
	interpreter, arguments := procfileShell("uvicorn app:app --port $PORT", runtime.GOOS, exec.LookPath)
	if web.Target != interpreter || strings.Join(web.ProgramArguments, " ") != strings.Join(arguments, " ") {
		t.Fatalf("web = %+v, want %s %v", web, interpreter, arguments)
	}
	// Senza sh (Windows senza Git Bash) si usa cmd; con sh si usa sh -c ovunque.
	found := func(string) (string, error) { return "", errors.New("not found") }
	if name, args := procfileShell("echo $PORT", "windows", found); name != "cmd" || strings.Join(args, " ") != "/c echo $PORT" {
		t.Fatalf("windows shell = %s %v", name, args)
	}
	have := func(string) (string, error) { return "sh", nil }
	if name, args := procfileShell("echo $PORT", "windows", have); name != "sh" || strings.Join(args, " ") != "-c echo $PORT" {
		t.Fatalf("shell = %s %v", name, args)
	}
}

// Le varianti Procfile.<nome> sono proposte con il proprio ID, senza confondere il processo con
// quello del Procfile principale.
func TestProcfileVariantsKeepDistinctSuggestions(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "Procfile"), "web: node app.js\n")
	writeFile(t, filepath.Join(root, "Procfile.dev"), "web: node app.js --watch\n")
	writeFile(t, filepath.Join(root, "Procfile.worker"), "worker: node jobs.js\n")
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "sub", "Procfile"), "nested: node nested.js\n")
	suggestions := procfileSuggestions(root)
	ids := map[string]string{}
	for _, suggestion := range suggestions {
		ids[suggestion.ID] = suggestion.Title
	}
	if len(suggestions) != 3 {
		t.Fatalf("suggestions = %+v", suggestions)
	}
	if ids["procfile|procfile.dev|web"] != "Procfile.dev · web" || ids["procfile|procfile.worker|worker"] != "Procfile.worker · worker" {
		t.Fatalf("titles = %v", ids)
	}
	// Il Procfile in una sottocartella non è la radice del progetto: non si propone.
	for id := range ids {
		if strings.Contains(id, "nested") {
			t.Fatalf("a nested Procfile was proposed: %v", ids)
		}
	}
}

// Il limite evita che un Procfile enorme produca decine di card.
func TestProcfileSuggestionsAreBounded(t *testing.T) {
	root := t.TempDir()
	lines := make([]string, 0, maxProcfileSuggestions+5)
	for index := range maxProcfileSuggestions + 5 {
		lines = append(lines, "p"+string(rune('a'+index))+": node app.js")
	}
	writeFile(t, filepath.Join(root, "Procfile"), strings.Join(lines, "\n"))
	if got := len(procfileSuggestions(root)); got != maxProcfileSuggestions {
		t.Fatalf("suggestions = %d, want %d", got, maxProcfileSuggestions)
	}
}
