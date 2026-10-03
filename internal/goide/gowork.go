package goide

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"golang.org/x/mod/modfile"
)

// go.work di Go Studio: stato letto con x/mod, modifiche solo con i comandi ufficiali
// `go work init`, `go work use` e `go work edit -dropuse`.

const goWorkCommandTimeout = 30 * time.Second

// GoWorkModule è un modulo rilevato nel progetto, con la sua appartenenza al workspace.
type GoWorkModule struct {
	// Directory relativa al progetto, "." per la radice.
	Directory   string `json:"directory"`
	ModulePath  string `json:"modulePath,omitempty"`
	InWorkspace bool   `json:"inWorkspace"`
}

// GoWorkState descrive il go.work del progetto.
type GoWorkState struct {
	Exists    bool           `json:"exists"`
	GoVersion string         `json:"goVersion,omitempty"`
	Modules   []GoWorkModule `json:"modules"`
	// Missing sono le cartelle usate da go.work che non contengono (più) un go.mod.
	Missing []string `json:"missing,omitempty"`
}

func workDirectory(root, directory string) string {
	if !filepath.IsAbs(directory) {
		directory = filepath.Join(root, directory)
	}
	relative, err := filepath.Rel(root, filepath.Clean(directory))
	if err != nil {
		return filepath.ToSlash(directory)
	}
	return filepath.ToSlash(relative)
}

// readGoWork restituisce le cartelle usate (normalizzate) e il testo originale di ciascuna direttiva use.
func readGoWork(root string) (bool, string, map[string]string, error) {
	path := filepath.Join(root, "go.work")
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, "", map[string]string{}, nil
	}
	if err != nil {
		return false, "", nil, err
	}
	work, err := modfile.ParseWork(path, data, nil)
	if err != nil {
		return true, "", nil, fmt.Errorf("go.work non valido: %w", err)
	}
	uses := make(map[string]string, len(work.Use))
	for _, use := range work.Use {
		uses[workDirectory(root, use.Path)] = use.Path
	}
	version := ""
	if work.Go != nil {
		version = work.Go.Version
	}
	return true, version, uses, nil
}

func goWorkState(project Project) (GoWorkState, error) {
	exists, version, uses, err := readGoWork(project.RootPath)
	if err != nil {
		return GoWorkState{}, err
	}
	state := GoWorkState{Exists: exists, GoVersion: version, Modules: []GoWorkModule{}}
	detected := map[string]bool{}
	for _, module := range goLayoutOf(project).Modules {
		directory := workDirectory(project.RootPath, module.Path)
		detected[directory] = true
		_, used := uses[directory]
		state.Modules = append(state.Modules, GoWorkModule{Directory: directory, ModulePath: module.ModulePath, InWorkspace: used})
	}
	for directory := range uses {
		if !detected[directory] {
			state.Missing = append(state.Missing, directory)
		}
	}
	slices.Sort(state.Missing)
	return state, nil
}

// GoWorkState legge go.work e lo confronta con i moduli rilevati nel progetto.
func (s *Service) GoWorkState(sessionID string) (GoWorkState, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return GoWorkState{}, err
	}
	return goWorkState(session.Project)
}

// UpdateGoWork porta go.work all'insieme di moduli indicato (cartelle relative al progetto).
// Crea go.work se manca; accetta solo moduli rilevati nel progetto.
func (s *Service) UpdateGoWork(sessionID string, directories []string) (GoWorkState, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return GoWorkState{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return GoWorkState{}, errors.New("autorizza gli strumenti del progetto per modificare go.work")
	}
	current, err := goWorkState(session.Project)
	if err != nil {
		return GoWorkState{}, err
	}
	known := map[string]bool{}
	for _, module := range current.Modules {
		known[module.Directory] = true
	}
	wanted := map[string]bool{}
	for _, directory := range directories {
		directory = workDirectory(session.Project.RootPath, directory)
		if !known[directory] {
			return GoWorkState{}, fmt.Errorf("%q non è un modulo rilevato nel progetto", directory)
		}
		wanted[directory] = true
	}
	_, _, uses, err := readGoWork(session.Project.RootPath)
	if err != nil {
		return GoWorkState{}, err
	}
	var add, drop []string
	for directory := range wanted {
		if _, used := uses[directory]; !used {
			add = append(add, "./"+strings.TrimPrefix(directory, "./"))
		}
	}
	for directory, original := range uses {
		if known[directory] && !wanted[directory] {
			drop = append(drop, original)
		}
	}
	slices.Sort(add)
	slices.Sort(drop)
	var commands [][]string
	if !current.Exists {
		if len(add) == 0 {
			return current, nil
		}
		commands = append(commands, append([]string{"work", "init"}, add...))
	} else {
		if len(add) > 0 {
			commands = append(commands, append([]string{"work", "use"}, add...))
		}
		for _, directory := range drop {
			commands = append(commands, []string{"work", "edit", "-dropuse=" + directory})
		}
	}
	if err := s.runGoCommands(session, commands); err != nil {
		return GoWorkState{}, err
	}
	refreshed, err := s.workspace.RefreshProject(session.ID)
	if err != nil {
		return GoWorkState{}, err
	}
	if err := s.saveState(); err != nil {
		return GoWorkState{}, err
	}
	s.emit("session.updated", refreshed.ID, string(refreshed.ID), refreshed)
	return goWorkState(refreshed.Project)
}

func (s *Service) runGoCommands(session Session, commands [][]string) error {
	if len(commands) == 0 {
		return nil
	}
	binary, err := s.toolchain.GoBinary(session.ID)
	if err != nil {
		return errors.New("go non disponibile: rileva o configura la toolchain")
	}
	environment, err := s.toolchain.Environment(session.ID, nil)
	if err != nil {
		return err
	}
	for _, arguments := range commands {
		ctx, cancel := context.WithTimeout(context.Background(), goWorkCommandTimeout)
		command := exec.CommandContext(ctx, binary, arguments...)
		command.Dir = session.Project.RootPath
		command.Env = environment
		configureProcess(command, false)
		output, err := command.CombinedOutput()
		cancel()
		if err != nil {
			return fmt.Errorf("go %s: %s", strings.Join(arguments, " "), strings.TrimSpace(string(output)))
		}
	}
	return nil
}

// CloneDestination è la cartella in cui finirà il clone: parent/<nome del repository>.
func CloneDestination(parent, remoteURL string) (string, error) {
	parent = strings.TrimSpace(parent)
	if parent == "" || !filepath.IsAbs(parent) {
		return "", errors.New("scegli una cartella di destinazione")
	}
	name := strings.TrimSuffix(strings.TrimRight(strings.TrimSpace(remoteURL), "/"), ".git")
	if index := strings.LastIndexAny(name, "/:"); index >= 0 {
		name = name[index+1:]
	}
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `\/:*?"<>|`) {
		return "", fmt.Errorf("nome del repository non valido in %q", remoteURL)
	}
	destination := filepath.Join(parent, name)
	if _, err := os.Stat(destination); err == nil {
		return "", fmt.Errorf("%s esiste già: scegli un'altra cartella", destination)
	}
	return destination, nil
}
