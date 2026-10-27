package maven

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
)

// Adapter è l'adapter Maven di adOmnia Security Intelligence.
type Adapter struct {
	Resolver Resolver
}

// New crea l'adapter Maven.
func New() *Adapter {
	return &Adapter{Resolver: Resolver{}}
}

// Ecosystem implementa securityintel.EcosystemAdapter.
func (*Adapter) Ecosystem() securityintel.Ecosystem { return securityintel.EcosystemMaven }

// Discover implementa securityintel.EcosystemAdapter. Trova i pom.xml del workspace.
func (*Adapter) Discover(ctx context.Context, root string) ([]securityintel.Target, error) {
	manifests, err := FindPOMs(root)
	if err != nil {
		return nil, err
	}
	targets := make([]securityintel.Target, 0, len(manifests))
	for _, manifest := range manifests {
		pom, _ := ReadPOM(manifest)
		name := pom.ArtifactID
		if name == "" {
			name = filepath.Base(filepath.Dir(manifest))
		}
		targets = append(targets, securityintel.Target{
			Ecosystem: securityintel.EcosystemMaven,
			Root:      filepath.Dir(manifest),
			Manifest:  manifest,
			Name:      name,
		})
	}
	builds, _ := FindGradleBuilds(root)
	for _, script := range builds {
		targets = append(targets, securityintel.Target{
			Ecosystem: securityintel.EcosystemMaven,
			Root:      filepath.Dir(script),
			Manifest:  script,
			Name:      filepath.Base(filepath.Dir(script)),
		})
	}
	return targets, nil
}

// Resolve implementa securityintel.EcosystemAdapter.
func (a *Adapter) Resolve(ctx context.Context, target securityintel.Target, options securityintel.ResolveOptions) (securityintel.Resolution, error) {
	if isGradleManifest(target.Manifest) {
		return a.Resolver.resolveGradle(ctx, target.Manifest)
	}
	result, err := a.Resolver.Resolve(ctx, target.Manifest, options)
	if err != nil {
		return securityintel.Resolution{}, err
	}
	return securityintel.Resolution{
		Components:   result.Components,
		Warnings:     result.Warnings,
		EffectivePOM: result.EffectivePOM,
	}, nil
}

// mavenDependencyTreePlugin è la versione fissata del plugin di dependency analysis.
// Va pinnata: una versione "latest" può cambiare comportamento o richiedere una JDK
// diversa senza che il progetto dell'utente cambi di una riga.
const mavenDependencyTreePlugin = "org.apache.maven.plugins:maven-dependency-plugin:3.8.1:tree"

// mavenTimeout è il tempo massimo di una risoluzione Maven.
const mavenTimeout = 3 * time.Minute

// resolveWithMaven esegue `mvn dependency:tree` e legge il grafo effettivo.
//
// È la risoluzione vera: transitività, versioni scelte dalla risoluzione, esclusioni
// e dipendenze dei parent remoti. Funziona solo se l'utente ha autorizzato l'avvio di
// processi esterni sul progetto.
func (r *Resolver) resolveWithMaven(ctx context.Context, pomPath string, options securityintel.ResolveOptions) (Result, error) {
	if !options.AllowProcesses {
		return Result{}, fmt.Errorf("external tools are not authorized for this project")
	}
	executable := r.MavenExecutable
	if executable == "" {
		executable = findMaven(options.Environment)
	}
	if executable == "" {
		return Result{}, fmt.Errorf("Maven is not installed")
	}
	runContext, cancel := context.WithTimeout(ctx, mavenTimeout)
	defer cancel()
	// procutil applica la politica di piattaforma: su Windows il processo non mostra
	// né trattiene una console visibile.
	command := procutil.CommandContext(runContext, executable,
		"-B", "-f", pomPath, mavenDependencyTreePlugin,
		"-DoutputType=text", "-Dtokens=standard", "-DappendOutput=false")
	command.Dir = filepath.Dir(pomPath)
	command.Env = processEnvironment(options.Environment)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); runContext.Err() != nil {
		return Result{}, fmt.Errorf("Maven dependency resolution timed out after %s", mavenTimeout)
	} else if err != nil && stdout.Len() == 0 {
		return Result{}, fmt.Errorf("Maven: %s", firstLine(stderr.String(), err.Error()))
	}
	components, warnings := parseDependencyTree(stdout.String(), filepath.Dir(pomPath))
	if len(components) == 0 {
		return Result{}, fmt.Errorf("Maven produced no dependency tree")
	}
	return Result{Components: components, Warnings: warnings, Transitive: true}, nil
}

// findMaven cerca l'eseguibile Maven: il wrapper del progetto prima, poi il PATH.
// Il wrapper è la scelta del progetto e va rispettata.
func findMaven(environment []string) string {
	wrapper := "mvnw"
	if runtime.GOOS == "windows" {
		wrapper = "mvnw.cmd"
	}
	for _, entry := range environment {
		if after, ok := strings.CutPrefix(entry, "MAVEN_WRAPPER_DIR="); ok {
			if candidate := filepath.Join(after, wrapper); isFile(candidate) {
				return candidate
			}
		}
	}
	if candidate, err := exec.LookPath(wrapper); err == nil {
		return candidate
	}
	if candidate, err := exec.LookPath("mvn"); err == nil {
		return candidate
	}
	if runtime.GOOS == "windows" {
		if candidate, err := exec.LookPath("mvn.cmd"); err == nil {
			return candidate
		}
	}
	return ""
}

// processEnvironment costruisce l'ambiente dei processi Maven.
func processEnvironment(environment []string) []string {
	if len(environment) > 0 {
		return environment
	}
	return os.Environ()
}

// firstLine ritorna la prima riga di un messaggio, o il fallback se è vuoto.
func firstLine(message, fallback string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		return fallback
	}
	if index := strings.IndexAny(message, "\r\n"); index >= 0 {
		return message[:index]
	}
	return message
}
