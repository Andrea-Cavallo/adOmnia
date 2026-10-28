package codestudio

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// Procfile (formato buildpack/Heroku) come proposta Run generica: vale per ogni linguaggio senza
// adapter — Node, Ruby, PHP, Elixir — e per i servizi avviati con un comando. Il parsing è locale e
// il processo parte solo su azione dell'utente, come per gli script (P2-B "Entry point"). Un
// comando che non sta in argv senza shell (`$PORT`, pipe, `&&`) viene eseguito dallo shell del
// sistema, come Heroku: la proposta resta modificabile prima di salvarla.

const maxProcfileSuggestions = 12

// procfileDirectories è dove si cerca: la radice del progetto (dove sta il Procfile) e nient'altro.
// Oltre al Procfile "classico" si leggono le varianti Procfile.<nome> (dev, prod, worker).
func procfileSuggestions(projectRoot string) []run.Suggestion {
	files, err := procfileFiles(projectRoot)
	if err != nil {
		return nil
	}
	var found []run.Suggestion
	for _, file := range files {
		data, err := os.ReadFile(filepath.Join(projectRoot, file))
		if err != nil {
			continue
		}
		for _, entry := range parseProcfile(string(data)) {
			if len(found) >= maxProcfileSuggestions {
				return found
			}
			found = append(found, procfileSuggestion(projectRoot, file, entry))
		}
	}
	return found
}

// procfileFiles elenca `Procfile` e `Procfile.*` nella radice, in ordine stabile.
func procfileFiles(projectRoot string) ([]string, error) {
	entries, err := os.ReadDir(projectRoot)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !isProcfileName(name) {
			continue
		}
		files = append(files, name)
	}
	sort.Strings(files)
	return files, nil
}

// isProcfileName riconosce `Procfile` e le sue varianti puntate. Il confronto è case-insensitive
// perché il file arriva da un repository che può averlo scritto in qualunque modo.
func isProcfileName(name string) bool {
	lower := strings.ToLower(name)
	return lower == "procfile" || strings.HasPrefix(lower, "procfile.")
}

// procfileEntry è un processo dichiarato: il nome (web, worker…) e il comando.
type procfileEntry struct {
	Name    string
	Command string
}

// parseProcfile legge le righe `nome: comando`. Righe vuote, commenti (`#`) e righe senza comando
// sono saltate: non si inventa un processo.
func parseProcfile(content string) []procfileEntry {
	var entries []procfileEntry
	for line := range strings.SplitSeq(content, "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, command, ok := strings.Cut(line, ":")
		name, command = strings.TrimSpace(name), strings.TrimSpace(command)
		if !ok || name == "" || command == "" || strings.ContainsRune(name, ' ') {
			continue
		}
		entries = append(entries, procfileEntry{Name: name, Command: command})
	}
	return entries
}

// shellOnlyCharacters sono i caratteri che solo una shell interpreta: espansione di variabili,
// pipe, redirezioni, sequenze, glob, sottoshell. Con uno di questi il comando non è esprimibile in
// argv e va eseguito dallo shell del sistema (come fa Heroku con il Procfile).
const shellOnlyCharacters = "$`|&;<>*?~{}()"

// procfileSuggestion costruisce la proposta per un processo del Procfile.
func procfileSuggestion(projectRoot, file string, entry procfileEntry) run.Suggestion {
	title := "Procfile · " + entry.Name
	if strings.ToLower(file) != "procfile" {
		title = file + " · " + entry.Name
	}
	configuration := run.Configuration{Name: title, Kind: "command"}
	if argv, ok := splitCommandLine(entry.Command); ok && !strings.ContainsAny(entry.Command, shellOnlyCharacters) {
		configuration.Target, configuration.ProgramArguments = argv[0], argv[1:]
	} else {
		interpreter, arguments := procfileShell(entry.Command, runtime.GOOS, exec.LookPath)
		configuration.Target, configuration.ProgramArguments = interpreter, arguments
	}
	return run.Suggestion{
		ID: "procfile|" + strings.ToLower(file) + "|" + entry.Name, Action: "run", UnitRoot: projectRoot,
		Title: title, Configuration: configuration,
	}
}

// procfileShell sceglie lo shell per un comando di Procfile che non sta in argv: `sh -c` quando sh
// esiste (anche su Windows con Git Bash: lì `$PORT` si espande come su Unix), altrimenti `cmd /c`.
// È lo stesso schema degli script .sh/.bat.
func procfileShell(command, goos string, lookPath func(string) (string, error)) (string, []string) {
	if _, err := lookPath("sh"); err == nil {
		return "sh", []string{"-c", command}
	}
	if goos == "windows" {
		return "cmd", []string{"/c", command}
	}
	return "sh", []string{"-c", command}
}

// splitCommandLine divide un comando in argv rispettando virgolette singole e doppie e la barra
// rovesciata. Non fa espansioni: se le virgolette non sono bilanciate il comando non è esprimibile
// in argv e il chiamante passa dallo shell.
func splitCommandLine(command string) ([]string, bool) {
	var (
		arguments []string
		current   strings.Builder
		quote     rune
		escaped   bool
		open      bool
	)
	for _, char := range command {
		switch {
		case escaped:
			current.WriteRune(char)
			escaped = false
		case char == '\\' && quote != '\'':
			escaped = true
		case quote != 0:
			if char == quote {
				quote = 0
			} else {
				current.WriteRune(char)
			}
		case char == '\'' || char == '"':
			quote, open = char, true
		case char == ' ' || char == '\t':
			if current.Len() > 0 || open {
				arguments = append(arguments, current.String())
				current.Reset()
				open = false
			}
		default:
			current.WriteRune(char)
		}
	}
	if quote != 0 || escaped {
		return nil, false
	}
	if current.Len() > 0 || open {
		arguments = append(arguments, current.String())
	}
	if len(arguments) == 0 || strings.TrimSpace(arguments[0]) == "" {
		return nil, false
	}
	return arguments, true
}
