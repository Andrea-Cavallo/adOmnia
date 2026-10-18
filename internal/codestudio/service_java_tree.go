package codestudio

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"adomnia/internal/ide/run"
	"adomnia/internal/languages/java"
	"adomnia/internal/procutil"
)

// Il primo dependency:tree può scaricare il plugin e le dipendenze: un tempo largo, ma finito.
const dependencyTreeTimeout = 5 * time.Minute

// JavaDependencyTree esegue `dependency:tree` nel modulo (cartella con pom.xml, relativa al progetto) e ne
// restituisce i nodi. È l'unico modo di sapere cosa il build risolve davvero; lancia Maven, quindi richiede
// il progetto autorizzato e può scaricare il plugin. Gradle non è ancora coperto.
func (s *Service) JavaDependencyTree(sessionID, relativeModule string) ([]java.TreeNode, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, fmt.Errorf("explicitly authorize the tools for this project")
	}
	module := filepath.Join(session.Project.RealPath, filepath.FromSlash(relativeModule))
	if rel, err := filepath.Rel(session.Project.RealPath, module); err != nil || strings.HasPrefix(rel, "..") {
		return nil, fmt.Errorf("the module is outside the project")
	}
	executable, _, kind, err := java.BuildToolOf(module)
	if err != nil {
		return nil, err
	}
	if kind != java.UnitMaven {
		return nil, fmt.Errorf("the dependency tree is available for Maven projects; Gradle is not covered yet")
	}
	output, err := os.CreateTemp("", "adomnia-deptree-*.txt")
	if err != nil {
		return nil, err
	}
	outputPath := output.Name()
	_ = output.Close()
	defer os.Remove(outputPath)

	arguments := java.DependencyTreeArguments(outputPath)
	if err := run.CheckBatchSafe(executable, arguments); err != nil {
		return nil, err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), dependencyTreeTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, executable, arguments...)
	command.Dir, command.Env = module, environment
	configureProcess(command, false)
	var log bytes.Buffer
	command.Stdout, command.Stderr = &log, &log
	runErr := command.Run()
	if ctx.Err() != nil {
		return nil, fmt.Errorf("dependency:tree took longer than %s", dependencyTreeTimeout)
	}
	data, readErr := os.ReadFile(outputPath)
	if readErr != nil || len(bytes.TrimSpace(data)) == 0 {
		message := strings.TrimSpace(log.String())
		if len(message) > 2000 {
			message = message[len(message)-2000:]
		}
		if runErr == nil {
			message = "Maven wrote no dependency tree"
		}
		return nil, fmt.Errorf("dependency:tree failed: %s", message)
	}
	return java.ParseDependencyTree(string(data)), nil
}
