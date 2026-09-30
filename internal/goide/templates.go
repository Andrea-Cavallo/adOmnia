package goide

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

// I template integrati usano il suffisso .tmpl così i sorgenti non vengono compilati
// come package di adOmnia; _common viene copiato in ogni template integrato.
//
//go:embed all:projecttemplates
var builtinTemplateFS embed.FS

const (
	customTemplatePrefix  = "custom:"
	maxTemplateFiles      = 500
	maxTemplateFileBytes  = 1 << 20
	templateTidyTimeout   = 2 * time.Minute
	templateModuleToken   = "__MODULE__"
	templateNameToken     = "__NAME__"
	templatePackageToken  = "__PACKAGE__"
	emptyProjectTemplate  = "empty"
	customTemplatesFolder = "go-templates"
)

// ProjectTemplate descrive un template selezionabile nel dialog New Project.
type ProjectTemplate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Custom      bool   `json:"custom,omitempty"`
	// Requires elenca i moduli aggiunti a go.mod: la creazione esegue go mod tidy.
	Requires []string `json:"requires,omitempty"`
}

type ProjectTemplateList struct {
	Templates []ProjectTemplate `json:"templates"`
	// CustomDirectory è la cartella locale dei template utente (può non esistere ancora).
	CustomDirectory string `json:"customDirectory"`
}

type CreateProjectResult struct {
	Session Session `json:"session"`
	// Warning segnala un passo non riuscito (es. go mod tidy offline) senza annullare la creazione.
	Warning string `json:"warning,omitempty"`
}

// Le versioni coincidono con quelle di adOmnia, così su una macchina che ha già
// compilato adOmnia go mod tidy le trova nella module cache anche offline.
var builtinTemplates = []ProjectTemplate{
	{ID: emptyProjectTemplate, Name: "Empty module", Description: "Only go.mod (go mod init)."},
	{ID: "cli", Name: "CLI", Description: "Command-line tool with flags and a test."},
	{ID: "rest", Name: "REST service", Description: "net/http API with routing, JSON and graceful shutdown."},
	{ID: "grpc", Name: "gRPC service", Description: "gRPC server with health, reflection and a sample .proto.", Requires: []string{"google.golang.org/grpc@v1.84.0"}},
	{ID: "worker", Name: "Worker", Description: "Background job loop with graceful shutdown."},
	{ID: "kafka", Name: "Kafka producer/consumer", Description: "Producer and consumer group on IBM/sarama.", Requires: []string{"github.com/IBM/sarama@v1.61.0"}},
	{ID: "library", Name: "Library", Description: "Importable package with a test and an Example."},
}

var customTemplatesRoot = func() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "adomnia", customTemplatesFolder), nil
}

// ListProjectTemplates restituisce i template integrati e quelli nella cartella utente.
func (s *Service) ListProjectTemplates() (ProjectTemplateList, error) {
	list := ProjectTemplateList{Templates: append([]ProjectTemplate(nil), builtinTemplates...)}
	root, err := customTemplatesRoot()
	if err != nil {
		return list, nil
	}
	list.CustomDirectory = root
	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return list, nil
		}
		return list, fmt.Errorf("impossibile leggere i template personalizzati: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() && projectNamePattern.MatchString(entry.Name()) {
			list.Templates = append(list.Templates, ProjectTemplate{
				ID: customTemplatePrefix + entry.Name(), Name: entry.Name(), Custom: true,
				Description: "Custom template from " + filepath.Join(root, entry.Name()),
			})
		}
	}
	return list, nil
}

// resolveProjectTemplate restituisce i file system da copiare (nil per il modulo vuoto).
func resolveProjectTemplate(id string) ([]fs.FS, ProjectTemplate, error) {
	if id == "" {
		id = emptyProjectTemplate
	}
	if name, ok := strings.CutPrefix(id, customTemplatePrefix); ok {
		if !projectNamePattern.MatchString(name) {
			return nil, ProjectTemplate{}, fmt.Errorf("template personalizzato non valido")
		}
		root, err := customTemplatesRoot()
		if err != nil {
			return nil, ProjectTemplate{}, err
		}
		dir := filepath.Join(root, name)
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			return nil, ProjectTemplate{}, fmt.Errorf("template personalizzato %q non trovato", name)
		}
		return []fs.FS{os.DirFS(dir)}, ProjectTemplate{ID: id, Name: name, Custom: true}, nil
	}
	for _, template := range builtinTemplates {
		if template.ID != id {
			continue
		}
		if id == emptyProjectTemplate {
			return nil, template, nil
		}
		common, _ := fs.Sub(builtinTemplateFS, "projecttemplates/_common")
		own, _ := fs.Sub(builtinTemplateFS, "projecttemplates/"+id)
		return []fs.FS{common, own}, template, nil
	}
	return nil, ProjectTemplate{}, fmt.Errorf("template %q sconosciuto", id)
}

// packageNameFor ricava un identificatore Go valido dall'ultimo elemento del module path.
func packageNameFor(modulePath string) string {
	var name strings.Builder
	for _, r := range strings.ToLower(path.Base(modulePath)) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			name.WriteRune(r)
		}
	}
	result := name.String()
	if result == "" || result[0] >= '0' && result[0] <= '9' {
		result = "lib" + result
	}
	return result
}

// renderProjectTemplate copia i file del template in target sostituendo i segnaposto
// nel contenuto testuale e nei percorsi. Symlink e .git vengono ignorati.
func renderProjectTemplate(sources []fs.FS, target string, replacer *strings.Replacer) error {
	count := 0
	for _, source := range sources {
		err := fs.WalkDir(source, ".", func(name string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if name == "." {
				return nil
			}
			if entry.IsDir() && entry.Name() == ".git" {
				return fs.SkipDir
			}
			if entry.Type()&fs.ModeSymlink != 0 {
				return nil
			}
			destination := filepath.Join(target, filepath.FromSlash(strings.TrimSuffix(replacer.Replace(name), ".tmpl")))
			if err := ensureWithinRoot(target, destination); err != nil {
				return err
			}
			if entry.IsDir() {
				return os.MkdirAll(destination, 0o755)
			}
			if count++; count > maxTemplateFiles {
				return fmt.Errorf("il template supera %d file", maxTemplateFiles)
			}
			data, err := fs.ReadFile(source, name)
			if err != nil {
				return err
			}
			if len(data) <= maxTemplateFileBytes && utf8.Valid(data) {
				data = []byte(replacer.Replace(string(data)))
			}
			if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
				return err
			}
			return os.WriteFile(destination, data, 0o644)
		})
		if err != nil {
			return fmt.Errorf("copia del template fallita: %w", err)
		}
	}
	return nil
}

// runGoCommand esegue go nella cartella indicata con timeout e output pulito per la UI.
func runGoCommand(binary, dir string, timeout time.Duration, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, args...)
	command.Dir = dir
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("go %s: %s", strings.Join(args, " "), strings.TrimSpace(string(output)))
	}
	return nil
}

// applyProjectTemplate scrive i file del template e risolve le dipendenze dichiarate.
// Restituisce un avviso (non un errore) se go mod tidy non riesce, es. offline.
func applyProjectTemplate(binary, target, modulePath, name, templateID string) (string, error) {
	sources, template, err := resolveProjectTemplate(templateID)
	if err != nil {
		return "", err
	}
	replacer := strings.NewReplacer(templateModuleToken, modulePath, templateNameToken, name, templatePackageToken, packageNameFor(modulePath))
	if err := renderProjectTemplate(sources, target, replacer); err != nil {
		return "", err
	}
	if len(template.Requires) == 0 {
		return "", nil
	}
	args := []string{"mod", "edit"}
	for _, requirement := range template.Requires {
		args = append(args, "-require="+requirement)
	}
	if err := runGoCommand(binary, target, 20*time.Second, args...); err != nil {
		return "", err
	}
	if err := runGoCommand(binary, target, templateTidyTimeout, "mod", "tidy"); err != nil {
		return fmt.Sprintf("Project created, but dependencies could not be resolved (%v). Run Tidy when online.", err), nil
	}
	return "", nil
}
