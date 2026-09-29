package goide

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// GoToolRequest chiede un comando della toolchain Go dal menu Go Tools, sempre come argomenti strutturati.
type GoToolRequest struct {
	SessionID        SessionID `json:"sessionId"`
	Tool             string    `json:"tool"`
	WorkingDirectory string    `json:"workingDirectory"`
	// Target è un package relativo (vet, generate, fix, doc), un percorso di import (mod why) o un simbolo (doc).
	Target string `json:"target"`
}

// GoToolPreview descrive il comando esatto prima dell'esecuzione.
type GoToolPreview struct {
	Command          string `json:"command"`
	WorkingDirectory string `json:"workingDirectory"`
	// ModifiesFiles avvisa che il comando riscrive sorgenti (go fix, go generate).
	ModifiesFiles bool `json:"modifiesFiles"`
}

type goToolSpec struct {
	// targetKind: "package" per un package relativo, "import" per un percorso di import, "symbol" per go doc, "" se non serve.
	targetKind    string
	modifiesFiles bool
	arguments     func(target string) []string
}

var goTools = map[string]goToolSpec{
	"vet":      {targetKind: "package", arguments: func(target string) []string { return []string{"vet", target} }},
	"generate": {targetKind: "package", modifiesFiles: true, arguments: func(target string) []string { return []string{"generate", target} }},
	"fix":      {targetKind: "package", modifiesFiles: true, arguments: func(target string) []string { return []string{"fix", target} }},
	"modWhy":   {targetKind: "import", arguments: func(target string) []string { return []string{"mod", "why", "-m", target} }},
	"modGraph": {arguments: func(string) []string { return []string{"mod", "graph"} }},
	"doc":      {targetKind: "symbol", arguments: func(target string) []string { return []string{"doc", "-all", target} }},
}

var (
	// importPathPattern accetta percorsi di import e moduli, mai un flag (nessun "-" iniziale).
	importPathPattern = regexp.MustCompile(`^[A-Za-z0-9_.~][A-Za-z0-9_.~/\-]*$`)
	// symbolPattern accetta package, package.Simbolo e package.Tipo.Metodo per go doc.
	symbolPattern = regexp.MustCompile(`^[A-Za-z0-9_.][A-Za-z0-9_./\-]*$`)
)

// goToolArguments valida il target secondo il comando e restituisce gli argomenti esatti.
func (s *Service) goToolArguments(session Session, request GoToolRequest) ([]string, string, goToolSpec, error) {
	spec, ok := goTools[request.Tool]
	if !ok {
		return nil, "", goToolSpec{}, fmt.Errorf("strumento Go non supportato")
	}
	workingDirectory, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return nil, "", goToolSpec{}, err
	}
	target := strings.TrimSpace(request.Target)
	switch spec.targetKind {
	case "package":
		if target == "" {
			target = "./..."
		}
		if err := validateRunTarget(session.Project.RealPath, workingDirectory, target); err != nil {
			return nil, "", goToolSpec{}, err
		}
	case "import":
		if !importPathPattern.MatchString(target) {
			return nil, "", goToolSpec{}, fmt.Errorf("indica un percorso di modulo o package, es. golang.org/x/text")
		}
	case "symbol":
		if !symbolPattern.MatchString(target) {
			return nil, "", goToolSpec{}, fmt.Errorf("indica un package o un simbolo, es. net/http.Client")
		}
	}
	return spec.arguments(target), workingDirectory, spec, nil
}

// PreviewGoTool mostra il comando esatto e la cartella di esecuzione, senza eseguire nulla.
func (s *Service) PreviewGoTool(request GoToolRequest) (GoToolPreview, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return GoToolPreview{}, err
	}
	arguments, workingDirectory, spec, err := s.goToolArguments(session, request)
	if err != nil {
		return GoToolPreview{}, err
	}
	return GoToolPreview{Command: displayCommand("go", arguments), WorkingDirectory: workingDirectory, ModifiesFiles: spec.modifiesFiles}, nil
}

// StartGoTool esegue il comando nella Run console; richiede l'autorizzazione strumenti del progetto.
func (s *Service) StartGoTool(request GoToolRequest) (Execution, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	arguments, workingDirectory, _, err := s.goToolArguments(session, request)
	if err != nil {
		return Execution{}, err
	}
	binary, err := s.toolchain.GoBinary(session.ID)
	if err != nil {
		return Execution{}, errors.New("go non disponibile: rileva o configura la toolchain prima di eseguire")
	}
	environment, err := s.toolchain.Environment(session.ID, nil)
	if err != nil {
		return Execution{}, err
	}
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "tool", Executable: binary, Arguments: arguments,
		WorkingDirectory: workingDirectory, Environment: environment, DisplayCommand: displayCommand("go", arguments),
	})
}
