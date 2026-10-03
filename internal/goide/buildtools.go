package goide

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Make e Docker: eseguono Makefile e Dockerfile del progetto con gli strumenti
// installati sulla macchina, senza shell intermedie. Il progetto deve essere
// autorizzato come per go run: un Makefile o un Dockerfile è codice del progetto.

var (
	makeArgumentPattern = regexp.MustCompile(`^[^-\x00\s][^\x00]*$`)
	dockerTagPattern    = regexp.MustCompile(`^[a-z0-9][a-z0-9._\-/:@]{0,254}$`)
	dockerStagePattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	dockerPortPattern   = regexp.MustCompile(`^((\d{1,3}\.){3}\d{1,3}:)?(\d{1,5}(-\d{1,5})?:)?\d{1,5}(-\d{1,5})?(/(tcp|udp|sctp))?$`)
	tagUnsafeCharacters = regexp.MustCompile(`[^a-z0-9._-]+`)
)

const (
	dockerProbeTimeout = 10 * time.Second
	dockerStopTimeout  = 15 * time.Second
)

func isToolRunKind(kind string) bool {
	return kind == string(RunKindMake) || kind == string(RunKindDockerBuild) || kind == string(RunKindDockerRun) || kind == string(RunKindDockerCompose)
}

// normalizeToolConfiguration valida i campi specifici di make e docker.
func normalizeToolConfiguration(config RunConfiguration) (RunConfiguration, error) {
	config.Target = strings.TrimSpace(config.Target)
	config.Files, config.BinaryPath, config.GoArguments, config.BuildTags = nil, "", nil, nil
	if config.Kind == RunKindDockerCompose {
		if config.Target == "" {
			config.Target = "docker-compose.yml"
		}
		config.Docker = DockerOptions{}
		arguments, err := normalizeComposeArguments(config.ProgramArguments)
		config.ProgramArguments = arguments
		return config, err
	}
	if config.Kind == RunKindMake {
		if config.Target == "" {
			config.Target = "Makefile"
		}
		config.Docker = DockerOptions{}
		arguments, err := normalizeMakeArguments(config.ProgramArguments)
		config.ProgramArguments = arguments
		return config, err
	}
	if config.Target == "" {
		config.Target = "Dockerfile"
	}
	docker, err := normalizeDockerOptions(config.Docker)
	config.Docker = docker
	return config, err
}

// normalizeMakeArguments accetta target e assegnazioni VAR=valore, non flag:
// le opzioni di make (-j, -k…) passano da MAKEFLAGS nell'ambiente.
func normalizeMakeArguments(values []string) ([]string, error) {
	arguments := trimArguments(values)
	for _, argument := range arguments {
		if !makeArgumentPattern.MatchString(argument) {
			return nil, fmt.Errorf("argomento make non valido: %q (usa target o VAR=valore; i flag vanno in MAKEFLAGS)", argument)
		}
	}
	return arguments, nil
}

var composeServicePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

// normalizeComposeArguments: "up" o "down" (default up) seguito da nomi di servizio, nient'altro.
func normalizeComposeArguments(values []string) ([]string, error) {
	arguments := trimArguments(values)
	if len(arguments) == 0 {
		arguments = []string{"up"}
	}
	if arguments[0] != "up" && arguments[0] != "down" {
		return nil, fmt.Errorf("comando compose non supportato: %q (up o down)", arguments[0])
	}
	if arguments[0] == "down" && len(arguments) > 1 {
		return nil, errors.New("compose down vale per l'intero file, senza servizi")
	}
	for _, service := range arguments[1:] {
		if !composeServicePattern.MatchString(service) {
			return nil, fmt.Errorf("nome di servizio compose non valido: %q", service)
		}
	}
	return arguments, nil
}

func normalizeDockerOptions(options DockerOptions) (DockerOptions, error) {
	options.Context = strings.TrimSpace(options.Context)
	if options.Context == "" {
		options.Context = "."
	}
	options.Tag = strings.TrimSpace(options.Tag)
	if options.Tag != "" && !dockerTagPattern.MatchString(options.Tag) {
		return options, fmt.Errorf("tag immagine non valido: %q (minuscole, cifre, . _ - / :)", options.Tag)
	}
	options.Stage = strings.TrimSpace(options.Stage)
	if options.Stage != "" && !dockerStagePattern.MatchString(options.Stage) {
		return options, fmt.Errorf("stage Docker non valido: %q", options.Stage)
	}
	buildArgs, err := normalizeEntries(options.BuildArgs, "build arg")
	if err != nil {
		return options, err
	}
	options.BuildArgs = buildArgs
	options.Ports = trimArguments(options.Ports)
	for _, port := range options.Ports {
		if !dockerPortPattern.MatchString(port) {
			return options, fmt.Errorf("porta non valida: %q (es. 8080 o 8080:80)", port)
		}
	}
	options.Volumes = trimArguments(options.Volumes)
	for _, volume := range options.Volumes {
		if _, _, _, err := splitVolume(volume); err != nil {
			return options, err
		}
	}
	return options, nil
}

// normalizeEntries ripulisce una lista chiave/valore rifiutando nomi vuoti, duplicati o non validi.
func normalizeEntries(entries []EnvironmentEntry, label string) ([]EnvironmentEntry, error) {
	seen := make(map[string]struct{}, len(entries))
	result := make([]EnvironmentEntry, 0, len(entries))
	for _, entry := range entries {
		key := strings.TrimSpace(entry.Key)
		if key == "" {
			continue
		}
		if !validEnvironmentName(key) {
			return nil, fmt.Errorf("nome di %s non valido: %q", label, key)
		}
		if _, duplicate := seen[key]; duplicate {
			return nil, fmt.Errorf("%s duplicato: %q", label, key)
		}
		seen[key] = struct{}{}
		result = append(result, EnvironmentEntry{Key: key, Value: entry.Value, Secret: entry.Secret})
	}
	return result, nil
}

// splitVolume separa "host:container[:ro|rw]". L'host deve essere relativo al
// progetto: niente bind di cartelle arbitrarie della macchina né del socket Docker.
func splitVolume(volume string) (host, container, mode string, err error) {
	parts := strings.Split(volume, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return "", "", "", fmt.Errorf("volume non valido: %q (usa percorso/relativo:/percorso/container[:ro])", volume)
	}
	host, container = strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	if len(parts) == 3 {
		mode = strings.TrimSpace(parts[2])
		if mode != "ro" && mode != "rw" {
			return "", "", "", fmt.Errorf("modalità volume non valida: %q (ro o rw)", mode)
		}
	}
	if host == "" || strings.HasPrefix(host, "-") || strings.HasPrefix(host, "/") || strings.HasPrefix(host, `\`) {
		return "", "", "", fmt.Errorf("il volume %q deve partire da un percorso relativo al progetto", volume)
	}
	if !strings.HasPrefix(container, "/") || strings.ContainsRune(volume, '\x00') {
		return "", "", "", fmt.Errorf("il percorso nel container di %q deve essere assoluto", volume)
	}
	return host, container, mode, nil
}

// validateToolPaths confina Makefile, Dockerfile, contesto e volumi alla radice del progetto.
func validateToolPaths(root, workingDirectory string, kind RunConfigurationKind, target string, docker DockerOptions) error {
	if err := validateRunTarget(root, workingDirectory, target); err != nil {
		return err
	}
	if kind == RunKindMake {
		return nil
	}
	if err := validateRunTarget(root, workingDirectory, docker.Context); err != nil {
		return fmt.Errorf("contesto Docker: %w", err)
	}
	for _, volume := range docker.Volumes {
		host, _, _, err := splitVolume(volume)
		if err != nil {
			return err
		}
		if err := validateRunTarget(root, workingDirectory, host); err != nil {
			return fmt.Errorf("volume %q: %w", volume, err)
		}
	}
	return nil
}

// toolCommandSpec traduce una richiesta make/docker in un comando strutturato.
// Per docker-run restituisce la build: il container parte dopo una build riuscita.
func (s *Service) toolCommandSpec(session Session, kind, workingDirectory, target string, request RunRequest) (CommandSpec, error) {
	file := filepath.Clean(filepath.Join(workingDirectory, filepath.FromSlash(target)))
	if info, err := os.Stat(file); err != nil || info.IsDir() {
		return CommandSpec{}, fmt.Errorf("file %q non trovato nel progetto", target)
	}
	if kind == string(RunKindDockerCompose) {
		return composeCommandSpec(file, target, request.ProgramArguments)
	}
	if kind == string(RunKindMake) {
		binary, err := s.resolveMake(session.ID)
		if err != nil {
			return CommandSpec{}, err
		}
		arguments, err := normalizeMakeArguments(request.ProgramArguments)
		if err != nil {
			return CommandSpec{}, err
		}
		arguments = append([]string{"-f", file}, arguments...)
		return CommandSpec{Executable: binary, Arguments: arguments, DisplayCommand: displayCommand("make", append([]string{"-f", target}, arguments[2:]...))}, nil
	}
	docker, err := resolveDocker()
	if err != nil {
		return CommandSpec{}, err
	}
	options, err := normalizeDockerOptions(request.Docker)
	if err != nil {
		return CommandSpec{}, err
	}
	contextDirectory := filepath.Clean(filepath.Join(workingDirectory, filepath.FromSlash(options.Context)))
	arguments := dockerBuildArguments(file, imageTag(session, options), contextDirectory, options, secretSet(request.Secrets))
	return CommandSpec{Executable: docker, Arguments: arguments, DisplayCommand: displayCommand("docker", arguments)}, nil
}

// dockerBuildArguments: i build arg segreti compaiono solo come nome.
func dockerBuildArguments(dockerfile, tag, contextDirectory string, options DockerOptions, secret map[string]bool) []string {
	arguments := []string{"build", "--progress=plain", "-f", dockerfile, "-t", tag}
	if options.Stage != "" {
		arguments = append(arguments, "--target", options.Stage)
	}
	if options.NoCache {
		arguments = append(arguments, "--no-cache")
	}
	for _, entry := range options.BuildArgs {
		arguments = append(arguments, "--build-arg", keyValueArgument(entry, secret))
	}
	return append(arguments, contextDirectory)
}

// composeCommandSpec: `docker compose -f file up [servizi]` resta agganciato e mostra i log;
// Stop esegue `docker compose stop`, perché uccidere il client lascerebbe i container accesi.
func composeCommandSpec(file, target string, values []string) (CommandSpec, error) {
	docker, err := resolveDocker()
	if err != nil {
		return CommandSpec{}, err
	}
	arguments, err := normalizeComposeArguments(values)
	if err != nil {
		return CommandSpec{}, err
	}
	full := append([]string{"compose", "-f", file}, arguments...)
	spec := CommandSpec{Executable: docker, Arguments: full, DisplayCommand: displayCommand("docker", append([]string{"compose", "-f", target}, arguments...))}
	if arguments[0] == "up" {
		services := arguments[1:]
		spec.OnStop = func() { stopCompose(docker, file, services) }
	}
	return spec, nil
}

func stopCompose(docker, file string, services []string) {
	ctx, cancel := context.WithTimeout(context.Background(), dockerStopTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, docker, append([]string{"compose", "-f", file, "stop", "-t", "3"}, services...)...)
	command.Dir = filepath.Dir(file)
	configureProcess(command, false)
	_ = command.Run()
}

// dockerRunSpec prepara il container di docker-run: --rm, stdin interattivo,
// nome noto per poterlo fermare davvero con docker stop.
func (s *Service) dockerRunSpec(session Session, workingDirectory string, request RunRequest) (CommandSpec, string, error) {
	docker, err := resolveDocker()
	if err != nil {
		return CommandSpec{}, "", err
	}
	options, err := normalizeDockerOptions(request.Docker)
	if err != nil {
		return CommandSpec{}, "", err
	}
	secret := secretSet(request.Secrets)
	name := newID("adomnia")
	arguments := []string{"run", "--rm", "-i", "--name", name, "--label", "adomnia.goide.session=" + string(session.ID)}
	for _, port := range options.Ports {
		arguments = append(arguments, "-p", port)
	}
	for _, volume := range options.Volumes {
		host, container, mode, _ := splitVolume(volume)
		bind := filepath.Clean(filepath.Join(workingDirectory, filepath.FromSlash(host))) + ":" + container
		if mode != "" {
			bind += ":" + mode
		}
		arguments = append(arguments, "-v", bind)
	}
	keys := make([]string, 0, len(request.Environment))
	for key := range request.Environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		arguments = append(arguments, "-e", keyValueArgument(EnvironmentEntry{Key: key, Value: request.Environment[key]}, secret))
	}
	arguments = append(arguments, imageTag(session, options))
	arguments = append(arguments, request.ProgramArguments...)
	display := displayCommand("docker", arguments[:len(arguments)-len(request.ProgramArguments)])
	if len(request.ProgramArguments) > 0 {
		display += fmt.Sprintf(" <%d container args>", len(request.ProgramArguments))
	}
	return CommandSpec{Executable: docker, Arguments: arguments, DisplayCommand: display, OnStop: func() { stopContainer(docker, name) }}, name, nil
}

// keyValueArgument scrive KEY=valore, oppure solo KEY per i segreti: docker
// legge allora il valore dall'ambiente del processo e non compare mai in riga di comando.
func keyValueArgument(entry EnvironmentEntry, secret map[string]bool) string {
	if secret[entry.Key] {
		return entry.Key
	}
	return entry.Key + "=" + entry.Value
}

func secretSet(keys []string) map[string]bool {
	set := make(map[string]bool, len(keys))
	for _, key := range keys {
		set[key] = true
	}
	return set
}

// imageTag usa il tag indicato o <progetto>:dev, ripulito per le regole di Docker.
func imageTag(session Session, options DockerOptions) string {
	if options.Tag != "" {
		return options.Tag
	}
	name := strings.Trim(tagUnsafeCharacters.ReplaceAllString(strings.ToLower(session.Project.Name), "-"), "-._")
	if name == "" {
		name = "adomnia-project"
	}
	return name + ":dev"
}

// stopContainer ferma davvero il container: uccidere il client docker lo lascerebbe acceso.
func stopContainer(docker, name string) {
	ctx, cancel := context.WithTimeout(context.Background(), dockerStopTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, docker, "stop", "-t", "3", name)
	configureProcess(command, false)
	_ = command.Run()
}

// resolveDocker verifica CLI e daemon prima di avviare, con un messaggio leggibile.
func resolveDocker() (string, error) {
	binary, err := exec.LookPath("docker")
	if err != nil {
		return "", errors.New("Docker non trovato: installa Docker Desktop (o Docker Engine) e assicurati che `docker` sia nel PATH")
	}
	ctx, cancel := context.WithTimeout(context.Background(), dockerProbeTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "version", "--format", "{{.Server.Version}}")
	configureProcess(command, false)
	if output, err := command.CombinedOutput(); err != nil {
		detail := strings.TrimSpace(string(output))
		if len(detail) > 200 {
			detail = detail[:200] + "…"
		}
		return "", fmt.Errorf("Docker daemon non raggiungibile: avvia Docker Desktop e riprova (%s)", detail)
	}
	return binary, nil
}

// MakeInfo descrive il make usato dalla sessione.
type MakeInfo struct {
	Available bool   `json:"available"`
	Binary    string `json:"binary,omitempty"`
	Source    string `json:"source,omitempty"`
	Error     string `json:"error,omitempty"`
}

const makeMissingMessage = "make non trovato: installalo (Windows: winget install ezwinports.make, choco install make o scoop install make) oppure indica il binario in Go → Tool Paths"

// makeCandidates: binario personalizzato, poi make/gmake/mingw32-make nel PATH e il percorso standard di GnuWin32.
func (s *Service) makeCandidates(sessionID SessionID) []MakeInfo {
	s.goplsMu.Lock()
	custom := s.makeBinaries[sessionID]
	s.goplsMu.Unlock()
	if custom != "" {
		return []MakeInfo{{Binary: custom, Source: "custom"}}
	}
	candidates := []MakeInfo{}
	for _, name := range []string{"make", "gmake", "mingw32-make"} {
		if binary, err := exec.LookPath(name); err == nil {
			candidates = append(candidates, MakeInfo{Binary: binary, Source: "path"})
		}
	}
	if programs := os.Getenv("ProgramFiles(x86)"); programs != "" {
		candidates = append(candidates, MakeInfo{Binary: filepath.Join(programs, "GnuWin32", "bin", "make.exe"), Source: "gnuwin32"})
	}
	return candidates
}

func (s *Service) resolveMake(sessionID SessionID) (string, error) {
	info := s.detectMake(sessionID)
	if !info.Available {
		return "", errors.New(info.Error)
	}
	return info.Binary, nil
}

func (s *Service) detectMake(sessionID SessionID) MakeInfo {
	for _, candidate := range s.makeCandidates(sessionID) {
		if stat, err := os.Stat(candidate.Binary); err == nil && !stat.IsDir() {
			candidate.Available = true
			return candidate
		}
		if candidate.Source == "custom" {
			return MakeInfo{Binary: candidate.Binary, Source: "custom", Error: "il binario make configurato non esiste"}
		}
	}
	return MakeInfo{Error: makeMissingMessage}
}

// DetectMake indica quale make userebbe la sessione.
func (s *Service) DetectMake(sessionID string) (MakeInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return MakeInfo{}, err
	}
	return s.detectMake(session.ID), nil
}

// ConfigureMake imposta un binario make personalizzato; vuoto torna alla ricerca automatica.
func (s *Service) ConfigureMake(sessionID, binary string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	binary = strings.TrimSpace(binary)
	if binary != "" {
		abs, err := filepath.Abs(binary)
		if err != nil {
			return fmt.Errorf("percorso make non valido: %w", err)
		}
		if info, err := os.Stat(abs); err != nil || info.IsDir() {
			return fmt.Errorf("il percorso indicato non è un eseguibile make")
		}
		binary = abs
	}
	s.goplsMu.Lock()
	if binary == "" {
		delete(s.makeBinaries, session.ID)
	} else {
		s.makeBinaries[session.ID] = binary
	}
	s.goplsMu.Unlock()
	return nil
}

// startToolRun avvia make, docker build o docker build + run. Per docker-run il
// container parte solo se la build termina con successo; Rerun rifà entrambi.
func (s *Service) startToolRun(session Session, kind, workingDirectory string, request RunRequest) (Execution, error) {
	target := strings.TrimSpace(request.Target)
	if target == "" {
		target = map[bool]string{true: "Makefile", false: "Dockerfile"}[kind == string(RunKindMake)]
	}
	request.Target = target
	if kind == string(RunKindDockerCompose) && target == "Dockerfile" {
		target = "docker-compose.yml"
		request.Target = target
	}
	if kind != string(RunKindMake) {
		options, err := normalizeDockerOptions(request.Docker)
		if err != nil {
			return Execution{}, err
		}
		request.Docker = options
	}
	if err := validateToolPaths(session.Project.RealPath, workingDirectory, RunConfigurationKind(kind), target, request.Docker); err != nil {
		return Execution{}, err
	}
	environment, err := s.toolchain.Environment(session.ID, toolEnvironment(kind, request))
	if err != nil {
		return Execution{}, err
	}
	spec, err := s.toolCommandSpec(session, kind, workingDirectory, target, request)
	if err != nil {
		return Execution{}, err
	}
	spec.SessionID, spec.Kind, spec.WorkingDirectory, spec.Environment = session.ID, kind, workingDirectory, environment
	if kind == string(RunKindDockerRun) {
		spec.Kind = string(RunKindDockerBuild)
		spec.OnExit = func(build Execution) {
			s.startContainerAfterBuild(session, workingDirectory, environment, request, build)
		}
	}
	execution, err := s.processes.Start(spec)
	if err != nil {
		return Execution{}, err
	}
	request.SessionID, request.WorkingDirectory, request.Kind = session.ID, workingDirectory, kind
	s.rememberRunRequest(execution.ID, request)
	return execution, nil
}

// toolEnvironment: make riceve tutte le variabili (make le vede come variabili);
// il client docker riceve solo i valori segreti, che docker legge con -e KEY / --build-arg KEY.
func toolEnvironment(kind string, request RunRequest) map[string]string {
	if kind == string(RunKindMake) || kind == string(RunKindDockerCompose) {
		return request.Environment
	}
	overrides := make(map[string]string)
	for _, key := range request.Secrets {
		if value, ok := request.Environment[key]; ok {
			overrides[key] = value
		}
		for _, entry := range request.Docker.BuildArgs {
			if entry.Key == key {
				overrides[key] = entry.Value
			}
		}
	}
	return overrides
}

func (s *Service) startContainerAfterBuild(session Session, workingDirectory string, environment []string, request RunRequest, build Execution) {
	if build.Status != "exited" || build.ExitCode == nil || *build.ExitCode != 0 {
		return
	}
	if current, err := s.session(string(session.ID)); err != nil || current.Project.Authorization != AuthorizationPermitted {
		return
	}
	spec, _, err := s.dockerRunSpec(session, workingDirectory, request)
	if err == nil {
		spec.SessionID, spec.Kind, spec.WorkingDirectory, spec.Environment = session.ID, string(RunKindDockerRun), workingDirectory, environment
		var execution Execution
		if execution, err = s.processes.Start(spec); err == nil {
			s.processes.Notice(build, "Build riuscita: container avviato ("+spec.DisplayCommand+")")
			s.rememberRunRequest(execution.ID, request)
			return
		}
	}
	s.processes.Notice(build, "Build riuscita, ma il container non è partito: "+err.Error())
}
