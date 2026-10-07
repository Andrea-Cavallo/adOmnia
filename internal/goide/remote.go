package goide

import (
	"context"
	"fmt"

	"adomnia/internal/ide/remote"
)

// RemoteTarget è un ambiente in cui eseguire run, test e comandi: distro WSL, host SSH o container.
type RemoteTarget = remote.Target

// ListRemoteTargets elenca gli ambienti raggiungibili da questa macchina (WSL, ~/.ssh/config, docker ps).
func (s *Service) ListRemoteTargets() []RemoteTarget {
	return remote.Discover(context.Background())
}

// applyRemote trasforma un comando locale nel comando che lo esegue nell'ambiente remoto della richiesta.
// L'ambiente locale resta al client (wsl.exe, ssh, docker: PATH, chiavi, socket); al processo remoto
// arrivano solo le variabili della configurazione.
func applyRemote(session Session, request RunRequest, spec CommandSpec) (CommandSpec, error) {
	if request.Remote == nil {
		return spec, nil
	}
	command, err := request.Remote.Wrap(session.Project.RealPath, spec.Executable, spec.Arguments, spec.WorkingDirectory, request.Environment)
	if err != nil {
		return CommandSpec{}, fmt.Errorf("esecuzione su %s: %w", request.Remote.Label(), err)
	}
	spec.Executable, spec.Arguments, spec.DisplayCommand = command.Executable, command.Arguments, command.Display
	spec.Environment = mergeEnvironment(spec.Environment, command.Environment)
	return spec, nil
}
