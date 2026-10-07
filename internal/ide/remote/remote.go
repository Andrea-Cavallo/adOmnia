// Package remote esegue i comandi dell'IDE dentro un altro ambiente — una distro WSL, un host SSH o un
// container Docker — invece che sulla macchina locale. È indipendente dal linguaggio: avvolge un comando
// già costruito (go test, cargo run, un binario…) e ne traduce i percorsi.
//
// Modello: il codice resta dov'è. Per WSL la cartella del progetto è già visibile dalla distro
// (/mnt/c/… o \\wsl.localhost\…); per SSH e container l'utente indica dove si trova la stessa
// cartella dall'altra parte (checkout remoto, bind mount del devcontainer).
package remote

import (
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

// Tipi di ambiente supportati.
const (
	KindWSL       = "wsl"
	KindSSH       = "ssh"
	KindContainer = "container"
)

// Target descrive dove eseguire: Kind, Name (distro, host di ~/.ssh/config o user@host, nome del container)
// e Directory, la radice del progetto vista dall'ambiente remoto (vuota per WSL = calcolata).
type Target struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Directory string `json:"directory,omitempty"`
}

// Command è un comando pronto da avviare in locale (wsl.exe, ssh o docker) che esegue quello richiesto
// nell'ambiente remoto. Environment (KEY=valore) va aggiunto all'ambiente del processo locale: così i
// valori, anche segreti, non compaiono nella riga di comando. Display è la forma leggibile.
type Command struct {
	Executable  string
	Arguments   []string
	Environment []string
	Display     string
}

// I nomi finiscono come argomento di wsl/ssh/docker: niente spazi e niente '-' iniziale (sarebbe un'opzione).
var namePattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.@:+-]{0,127}$`)

var envKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// Validate controlla il target prima di usarlo.
func (t Target) Validate() error {
	switch t.Kind {
	case KindWSL:
		if runtime.GOOS != "windows" {
			return fmt.Errorf("WSL è disponibile solo su Windows")
		}
	case KindSSH, KindContainer:
		if !path.IsAbs(t.Directory) {
			return fmt.Errorf("indica la cartella del progetto su %s come percorso assoluto, es. /home/me/progetto", t.Name)
		}
	default:
		return fmt.Errorf("ambiente remoto non supportato: %q", t.Kind)
	}
	if !namePattern.MatchString(t.Name) {
		return fmt.Errorf("nome dell'ambiente remoto non valido: %q", t.Name)
	}
	if strings.ContainsAny(t.Directory, "\x00\n\r") {
		return fmt.Errorf("cartella remota non valida")
	}
	return nil
}

// Label è il nome mostrato nell'interfaccia, es. "Ubuntu (WSL)".
func (t Target) Label() string {
	switch t.Kind {
	case KindWSL:
		return t.Name + " (WSL)"
	case KindSSH:
		return t.Name + " (SSH)"
	default:
		return t.Name + " (container)"
	}
}

// RemoteRoot è la radice del progetto vista dall'ambiente: Directory se indicata, altrimenti per WSL
// il percorso Linux della cartella Windows.
func (t Target) RemoteRoot(localRoot string) (string, error) {
	if t.Directory != "" {
		return path.Clean(t.Directory), nil
	}
	if t.Kind != KindWSL {
		return "", fmt.Errorf("cartella remota mancante")
	}
	return WSLPath(localRoot)
}

// WSLPath traduce un percorso Windows nel percorso visto da WSL: \\wsl.localhost\Distro\home\x → /home/x,
// C:\Users\x → /mnt/c/Users/x.
func WSLPath(windowsPath string) (string, error) {
	clean := strings.ReplaceAll(windowsPath, "/", `\`)
	lower := strings.ToLower(clean)
	for _, prefix := range []string{`\\wsl.localhost\`, `\\wsl$\`} {
		if strings.HasPrefix(lower, prefix) {
			rest := clean[len(prefix):]
			if index := strings.Index(rest, `\`); index >= 0 {
				return "/" + strings.ReplaceAll(strings.Trim(rest[index+1:], `\`), `\`, "/"), nil
			}
			return "/", nil
		}
	}
	if len(clean) >= 2 && clean[1] == ':' {
		drive := strings.ToLower(clean[:1])
		rest := strings.ReplaceAll(strings.Trim(clean[2:], `\`), `\`, "/")
		return strings.TrimRight("/mnt/"+drive+"/"+rest, "/"), nil
	}
	return "", fmt.Errorf("%s non è raggiungibile da WSL", windowsPath)
}

// Wrap traduce un comando locale (eseguibile, argomenti, cartella) in un comando eseguito nel target.
// I percorsi sotto localRoot negli argomenti diventano percorsi remoti; l'eseguibile è cercato sul PATH
// remoto per nome (go.exe → go), un binario del progetto col suo percorso remoto. Environment sono solo le variabili della configurazione: l'ambiente
// locale non viene esportato. Lo stdin locale fa da guardia: chiuso (Stop), il processo remoto termina.
func (t Target) Wrap(localRoot, executable string, arguments []string, workingDirectory string, environment map[string]string) (Command, error) {
	if err := t.Validate(); err != nil {
		return Command{}, err
	}
	remoteRoot, err := t.RemoteRoot(localRoot)
	if err != nil {
		return Command{}, err
	}
	mapPath := func(value string) string { return mapLocalPath(localRoot, remoteRoot, value) }
	directory := mapPath(workingDirectory)
	if !path.IsAbs(directory) {
		return Command{}, fmt.Errorf("la cartella %s non è dentro il progetto", workingDirectory)
	}
	keys := make([]string, 0, len(environment))
	for key := range environment {
		if !envKeyPattern.MatchString(key) {
			return Command{}, fmt.Errorf("nome di variabile non valido: %q", key)
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	local := make([]string, 0, len(keys)+1)
	for _, key := range keys {
		local = append(local, key+"="+mapPath(environment[key]))
	}
	// Un binario del progetto si raggiunge col suo percorso remoto; uno strumento (go.exe) per nome sul PATH.
	program := mapPath(executable)
	if program == executable {
		program = remoteExecutable(executable)
	}
	command := []string{program}
	for _, argument := range arguments {
		command = append(command, mapPath(argument))
	}
	display := strings.Join(append([]string{program}, arguments...), " ") + " @ " + t.Label()
	switch t.Kind {
	case KindWSL:
		// WSLENV elenca le variabili Windows da passare alla distro (/u: solo verso Linux).
		if len(keys) > 0 {
			local = append(local, "WSLENV="+strings.Join(keys, "/u:")+"/u")
		}
		return Command{Executable: "wsl.exe", Arguments: []string{"-d", t.Name, "--exec", "sh", "-c", guardScript(directory, command)}, Environment: local, Display: display}, nil
	case KindSSH:
		// ponytail: SSH non ha un canale affidabile per l'ambiente (AcceptEnv è raro), i valori viaggiano
		// nel comando remoto e sono visibili nella process list dell'host; per segreti veri usa un file sul server.
		script := guardScript(directory, append(append([]string{"env"}, local...), command...))
		// BatchMode: senza terminale una richiesta di password resterebbe appesa; servono chiavi o agent.
		return Command{Executable: "ssh", Arguments: []string{"-T", "-o", "BatchMode=yes", t.Name, "--", "sh -c " + Quote(script)}, Display: display}, nil
	default:
		arguments := []string{"exec", "-i"}
		for _, key := range keys {
			arguments = append(arguments, "-e", key) // senza valore: docker lo legge dall'ambiente del client
		}
		arguments = append(arguments, t.Name, "sh", "-c", guardScript(directory, command))
		return Command{Executable: "docker", Arguments: arguments, Environment: local, Display: display}, nil
	}
}

// guardScript avvia il comando in un proprio process group e lo termina quando lo stdin si chiude:
// wsl.exe, ssh e docker exec da soli lascerebbero vivo il processo remoto dopo Stop.
// ponytail: lo stdin fa da guardia, quindi le esecuzioni remote non ricevono input interattivo.
func guardScript(directory string, command []string) string {
	quoted := make([]string, len(command))
	for i, part := range command {
		quoted[i] = Quote(part)
	}
	return "cd " + Quote(directory) + " || exit 127\n" +
		"set -m\n" +
		strings.Join(quoted, " ") + " </dev/null &\n" +
		"p=$!\n" +
		"( cat >/dev/null; kill -TERM -$p 2>/dev/null ) >/dev/null 2>&1 &\n" +
		"wait $p"
}

// Quote rende una stringa un singolo argomento per sh.
func Quote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func remoteExecutable(executable string) string {
	name := filepath.Base(executable)
	if strings.EqualFold(filepath.Ext(name), ".exe") {
		name = name[:len(name)-4]
	}
	return name
}

// mapLocalPath sostituisce il prefisso localRoot (anche dentro -flag=valore) con remoteRoot.
func mapLocalPath(localRoot, remoteRoot, value string) string {
	root := filepath.Clean(localRoot)
	for _, candidate := range []string{root, filepath.ToSlash(root)} {
		index := indexFold(value, candidate)
		if index < 0 {
			continue
		}
		rest := value[index+len(candidate):]
		if rest != "" && rest[0] != '/' && rest[0] != '\\' {
			continue
		}
		return value[:index] + path.Join(remoteRoot, filepath.ToSlash(strings.ReplaceAll(rest, `\`, "/")))
	}
	return value
}

// indexFold cerca il prefisso ignorando le maiuscole solo su Windows, dove i percorsi non le distinguono.
func indexFold(value, prefix string) int {
	if runtime.GOOS == "windows" {
		return strings.Index(strings.ToLower(value), strings.ToLower(prefix))
	}
	return strings.Index(value, prefix)
}
