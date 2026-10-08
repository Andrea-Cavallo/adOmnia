package plugins

import (
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// PluginContributes is the public extension API of a plugin: what it adds to the IDE beyond hooks and
// actions. Everything that runs code points at an action of the same manifest, so it goes through the
// sandbox, permissions and limits like any other action.
type PluginContributes struct {
	// Commands appear in the Go Studio command palette and Plugins menu.
	Commands []ContributedCommand `json:"commands,omitempty"`
	// CodeActions appear in the editor lightbulb / context menu and may rewrite the selection or the file.
	CodeActions []ContributedCodeAction `json:"codeActions,omitempty"`
	// Analyzers run on save and return diagnostics shown as editor markers and in Problems.
	Analyzers []ContributedAnalyzer `json:"analyzers,omitempty"`
	// Templates are file trees under the plugin directory offered by New Project.
	Templates []ContributedTemplate `json:"templates,omitempty"`
	// Languages register file extensions and an optional language server (any LSP over stdio).
	Languages []ContributedLanguage `json:"languages,omitempty"`
	// Adapters teach service detection about frameworks, brokers and databases by Go module path.
	Adapters []ContributedAdapter `json:"adapters,omitempty"`
}

// ContributedCommand runs Action with the IDE context (project, file, selection).
type ContributedCommand struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Action string `json:"action"`
}

// ContributedCodeAction runs Action on the current file and selection; empty Languages = every language.
type ContributedCodeAction struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Action    string   `json:"action"`
	Languages []string `json:"languages,omitempty"`
}

// ContributedAnalyzer runs Action with the saved file's text and returns {diagnostics: [...]}.
type ContributedAnalyzer struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Action    string   `json:"action"`
	Languages []string `json:"languages,omitempty"`
}

// ContributedTemplate is a project template: Directory (inside the plugin) is copied into the new project.
type ContributedTemplate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Directory   string `json:"directory"`
}

// ContributedLanguage adds a language to the IDE: file extensions, the Monaco grammar to reuse
// for highlighting, and a language server started on demand for trusted projects.
type ContributedLanguage struct {
	ID         string                     `json:"id"`
	Name       string                     `json:"name"`
	Extensions []string                   `json:"extensions"`
	Monaco     string                     `json:"monaco,omitempty"`
	Server     *ContributedLanguageServer `json:"server,omitempty"`
}

// ContributedLanguageServer is an executable on the PATH speaking LSP over stdio.
type ContributedLanguageServer struct {
	Command   string   `json:"command"`
	Arguments []string `json:"args,omitempty"`
}

// ContributedAdapter recognizes a framework, broker or database from the project's direct Go dependencies.
type ContributedAdapter struct {
	Kind    string   `json:"kind"` // framework, broker, database
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Modules []string `json:"modules"`
}

var (
	contributionIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`)
	extensionPattern      = regexp.MustCompile(`^\.[a-zA-Z0-9_+-]{1,16}$`)
	commandNamePattern    = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,127}$`)
	modulePathPattern     = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._~/-]{1,255}$`)
	languageIDPattern     = regexp.MustCompile(`^[a-z][a-z0-9+#._-]{0,31}$`)
)

// Reserved language IDs belong to built-in adapters: a plugin cannot replace Go.
var reservedLanguages = map[string]bool{"go": true, "generic": true}

func validateContributes(manifest *PluginManifest) error {
	c := &manifest.Contributes
	actions := map[string]bool{}
	for _, action := range manifest.Actions {
		actions[action.ID] = true
	}
	seen := map[string]bool{}
	unique := func(kind, id string) error {
		key := kind + ":" + id
		if seen[key] {
			return fmt.Errorf("contributes.%s: duplicate id %q", kind, id)
		}
		seen[key] = true
		return nil
	}
	needsAction := func(kind, id, action string) error {
		if err := unique(kind, id); err != nil {
			return err
		}
		if !contributionIDPattern.MatchString(id) {
			return fmt.Errorf("contributes.%s: invalid id %q", kind, id)
		}
		if !actions[action] {
			return fmt.Errorf("contributes.%s %s: action %q is not declared in actions", kind, id, action)
		}
		return nil
	}
	for i := range c.Commands {
		if err := needsAction("commands", c.Commands[i].ID, c.Commands[i].Action); err != nil {
			return err
		}
		if strings.TrimSpace(c.Commands[i].Title) == "" {
			c.Commands[i].Title = c.Commands[i].ID
		}
	}
	for i := range c.CodeActions {
		if err := needsAction("codeActions", c.CodeActions[i].ID, c.CodeActions[i].Action); err != nil {
			return err
		}
		if strings.TrimSpace(c.CodeActions[i].Title) == "" {
			c.CodeActions[i].Title = c.CodeActions[i].ID
		}
	}
	for i := range c.Analyzers {
		if err := needsAction("analyzers", c.Analyzers[i].ID, c.Analyzers[i].Action); err != nil {
			return err
		}
		if strings.TrimSpace(c.Analyzers[i].Name) == "" {
			c.Analyzers[i].Name = c.Analyzers[i].ID
		}
	}
	for _, template := range c.Templates {
		if err := unique("templates", template.ID); err != nil {
			return err
		}
		if !contributionIDPattern.MatchString(template.ID) || strings.TrimSpace(template.Name) == "" {
			return fmt.Errorf("contributes.templates: id and name are required")
		}
		clean := strings.ReplaceAll(template.Directory, "\\", "/")
		if clean == "" || strings.HasPrefix(clean, "/") || strings.Contains(clean, ":") || strings.Split(clean, "/")[0] == ".." || strings.Contains(clean, "/../") {
			return fmt.Errorf("contributes.templates %s: directory must be a relative path inside the plugin", template.ID)
		}
	}
	for _, language := range c.Languages {
		if err := unique("languages", language.ID); err != nil {
			return err
		}
		if !languageIDPattern.MatchString(language.ID) || reservedLanguages[strings.ToLower(language.ID)] {
			return fmt.Errorf("contributes.languages: invalid or reserved id %q", language.ID)
		}
		if len(language.Extensions) == 0 {
			return fmt.Errorf("contributes.languages %s: at least one extension is required", language.ID)
		}
		for _, extension := range language.Extensions {
			if !extensionPattern.MatchString(extension) || strings.EqualFold(extension, ".go") {
				return fmt.Errorf("contributes.languages %s: invalid extension %q", language.ID, extension)
			}
		}
		if language.Server != nil && !commandNamePattern.MatchString(language.Server.Command) {
			return fmt.Errorf("contributes.languages %s: the server command must be a program name on the PATH", language.ID)
		}
	}
	for _, adapter := range c.Adapters {
		if err := unique("adapters", adapter.ID); err != nil {
			return err
		}
		if adapter.Kind != "framework" && adapter.Kind != "broker" && adapter.Kind != "database" {
			return fmt.Errorf("contributes.adapters %s: kind must be framework, broker or database", adapter.ID)
		}
		if !contributionIDPattern.MatchString(adapter.ID) || strings.TrimSpace(adapter.Name) == "" || len(adapter.Modules) == 0 {
			return fmt.Errorf("contributes.adapters: id, name and modules are required")
		}
		for _, module := range adapter.Modules {
			if !modulePathPattern.MatchString(module) {
				return fmt.Errorf("contributes.adapters %s: invalid module path %q", adapter.ID, module)
			}
		}
	}
	return nil
}

// Contribution is one contributed item with the plugin that owns it, as the IDE consumes it.
type Contribution struct {
	PluginID   string `json:"pluginId"`
	PluginName string `json:"pluginName"`
	// Kind is command, codeAction, analyzer, template, language or adapter.
	Kind        string                     `json:"kind"`
	ID          string                     `json:"id"`
	Title       string                     `json:"title"`
	Action      string                     `json:"action,omitempty"`
	Languages   []string                   `json:"languages,omitempty"`
	Description string                     `json:"description,omitempty"`
	Directory   string                     `json:"directory,omitempty"`
	Extensions  []string                   `json:"extensions,omitempty"`
	Monaco      string                     `json:"monaco,omitempty"`
	Server      *ContributedLanguageServer `json:"server,omitempty"`
	AdapterKind string                     `json:"adapterKind,omitempty"`
	Modules     []string                   `json:"modules,omitempty"`
}

// GetContributions lists what the enabled, healthy plugins add to the IDE, in a stable order.
func (pm *PluginManager) GetContributions() []Contribution {
	pm.refreshSignatures()
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	var out []Contribution
	for _, inst := range pm.plugins {
		if !inst.Enabled || inst.Error != "" {
			continue
		}
		m := inst.Manifest
		base := Contribution{PluginID: m.ID, PluginName: m.Name}
		add := func(item Contribution) { out = append(out, item) }
		for _, c := range m.Contributes.Commands {
			item := base
			item.Kind, item.ID, item.Title, item.Action = "command", c.ID, c.Title, c.Action
			add(item)
		}
		for _, c := range m.Contributes.CodeActions {
			item := base
			item.Kind, item.ID, item.Title, item.Action, item.Languages = "codeAction", c.ID, c.Title, c.Action, c.Languages
			add(item)
		}
		for _, c := range m.Contributes.Analyzers {
			item := base
			item.Kind, item.ID, item.Title, item.Action, item.Languages = "analyzer", c.ID, c.Name, c.Action, c.Languages
			add(item)
		}
		for _, c := range m.Contributes.Templates {
			item := base
			item.Kind, item.ID, item.Title, item.Description = "template", c.ID, c.Name, c.Description
			item.Directory = joinInside(inst.InstallDir, c.Directory)
			add(item)
		}
		for _, c := range m.Contributes.Languages {
			item := base
			item.Kind, item.ID, item.Title, item.Extensions, item.Monaco, item.Server = "language", c.ID, c.Name, c.Extensions, c.Monaco, c.Server
			add(item)
		}
		for _, c := range m.Contributes.Adapters {
			item := base
			item.Kind, item.ID, item.Title, item.AdapterKind, item.Modules = "adapter", c.ID, c.Name, c.Kind, c.Modules
			add(item)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		if out[i].PluginID != out[j].PluginID {
			return out[i].PluginID < out[j].PluginID
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// joinInside joins a validated relative directory to the plugin install directory.
func joinInside(installDir, relative string) string {
	return filepath.Join(installDir, filepath.FromSlash(strings.ReplaceAll(relative, "\\", "/")))
}
