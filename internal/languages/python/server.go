package python

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"adomnia/internal/ide/lsp"
	"adomnia/internal/ide/project"
	"adomnia/internal/ide/sdk"
)

// basedpyright è il language server Python. Versione pinnata (PY-0.2): per aggiornarla si cambia
// qui e si ricontrolla il contratto LSP. L'installazione è esplicita, isolata nella cartella
// strumenti di adOmnia (pip --target), mai nei pacchetti del progetto né in quelli dell'utente:
// local-first, nessun download silenzioso (9.3).
const (
	pyrightName        = "basedpyright"
	pyrightVersion     = "1.40.2"
	pyrightInstallTask = "install-python-language-server"
	pyrightLangserver  = "basedpyright-langserver"
)

// managedDirectory è la cartella di installazione isolata: il pacchetto e gli script generati
// da pip (`bin/`), compreso il runtime Node incluso da nodejs-wheel.
func managedDirectory(toolsRoot string) string { return filepath.Join(toolsRoot, pyrightName) }

// LocateServer implementa lsp.ServerProvider: il server del progetto (installato nel suo
// ambiente), quello gestito da adOmnia o uno nel PATH. Un server mancante non è fatale:
// l'editor continua con le funzioni di Monaco.
func (l *Language) LocateServer(root, toolsRoot string) lsp.ServerInfo {
	info := lsp.ServerInfo{Language: ID, Name: pyrightName}
	if binary := projectLanguageServer(root); binary != "" {
		info.Available, info.Binary, info.Source = true, binary, "project"
		return info
	}
	if toolsRoot != "" && isFile(filepath.Join(managedDirectory(toolsRoot), "basedpyright", "langserver.py")) {
		info.Available, info.Binary, info.Source = true, managedDirectory(toolsRoot), "managed"
		return info
	}
	if binary, err := lookPath(pyrightLangserver); err == nil && isFile(binary) {
		info.Available, info.Binary, info.Source = true, binary, "PATH"
		return info
	}
	info.Error = "basedpyright is not installed: install the Python language server from the editor notice, or run `pip install " + pyrightName + "==" + pyrightVersion + "` in your environment"
	return info
}

// projectLanguageServer è il basedpyright installato nell'ambiente del progetto (console script
// di pip dentro .venv), "" se non c'è.
func projectLanguageServer(root string) string {
	for _, candidate := range DiscoverInterpreters(root, root) {
		if candidate.Source != "project" {
			continue
		}
		binary := filepath.Join(filepath.Dir(candidate.Path), sdk.ExecutableName(pyrightLangserver))
		if isFile(binary) {
			return binary
		}
	}
	return ""
}

// ServerSpec implementa lsp.ServerProvider. Il server gestito parte con l'interprete di
// avvio e PYTHONPATH sulla cartella strumenti: il progetto non viene toccato.
func (l *Language) ServerSpec(root, toolsRoot string) (lsp.ServerSpec, error) {
	info := l.LocateServer(root, toolsRoot)
	if !info.Available {
		return lsp.ServerSpec{}, fmt.Errorf("%s", info.Error)
	}
	spec := lsp.ServerSpec{
		Language: ID, Name: info.Name, Version: pyrightVersion,
		Binary: info.Binary, Arguments: []string{"--stdio"},
		TraceEnvironment: []string{"VIRTUAL_ENV", "PYTHONPATH"},
		WatchesFile:      watchesPythonFile,
		Configuration:    func() any { return pyrightSettings(root) },
	}
	if info.Source == "managed" {
		interpreter, err := bootstrapInterpreter()
		if err != nil {
			return lsp.ServerSpec{}, err
		}
		spec.Binary = interpreter
		spec.Arguments = []string{"-c", "from basedpyright.langserver import main; main()", "--stdio"}
		spec.Environment = withPythonPath(os.Environ(), info.Binary)
	}
	return spec, nil
}

// pyrightSettings è la configurazione servita a workspace/configuration: l'interprete scelto
// per il progetto, così i import si risolvono con lo stesso ambiente di Run/Test/Debug (PY-2.5).
// pyrightconfig.json e [tool.pyright] del progetto restano la fonte delle altre impostazioni.
func pyrightSettings(root string) any {
	settings := map[string]any{
		"python":     map[string]any{},
		"basedpyright": map[string]any{"analysis": map[string]any{"diagnosticMode": "openFilesOnly"}},
	}
	if interpreter, err := ResolveInterpreter(root, root, ""); err == nil {
		settings["python"] = map[string]any{"pythonPath": interpreter.Path}
	}
	return settings
}

// watchesPythonFile dice quali file cambiati su disco interessano il server: sorgenti e
// manifest che spostano il percorso degli import.
func watchesPythonFile(path string) bool {
	switch strings.ToLower(filepath.Base(path)) {
	case "pyproject.toml", "pyrightconfig.json", "setup.cfg", "setup.py", "requirements.txt", "tox.ini", "poetry.lock", "uv.lock", ".python-version":
		return true
	}
	if project.IgnoredDirectory(filepath.Base(filepath.Dir(path))) {
		return false
	}
	extension := strings.ToLower(filepath.Ext(path))
	return extension == ".py" || extension == ".pyi" || extension == ".pyw"
}

// InstallPlan installa basedpyright nella cartella strumenti con un solo comando visibile:
// pip --target con la versione pinnata. Serve un interprete Python della macchina.
func (*Language) InstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	interpreter, err := bootstrapInterpreter()
	if err != nil {
		return lsp.InstallPlan{}, err
	}
	directory := managedDirectory(toolsRoot)
	arguments := []string{"-m", "pip", "install", "--upgrade", "--target", directory, pyrightName + "==" + pyrightVersion}
	return lsp.InstallPlan{
		Task: pyrightInstallTask, Title: "Install the Python language server?",
		Label: "Installing basedpyright",
		Note: fmt.Sprintf("Installs %s %s into the adOmnia tools folder (%s), never into your project or your Python environments. Needs network access now; afterwards basedpyright works offline.", pyrightName, pyrightVersion, directory),
		Command:    strings.Join(append([]string{sdk.ExecutableName("python")}, arguments...), " "),
		Executable: interpreter, Arguments: arguments, Directory: directory,
		Prepare:   func() error { return os.MkdirAll(directory, 0o755) },
		Languages: []string{ID},
	}, nil
}

// bootstrapInterpreter è l'interprete della macchina che esegue pip e il server gestito:
// un Python del PATH, mai quello del progetto (l'installazione deve restare isolata).
func bootstrapInterpreter() (string, error) {
	for _, name := range pathInterpreterNames() {
		if binary, err := lookPath(name); err == nil && isInterpreter(binary) {
			return binary, nil
		}
	}
	return "", fmt.Errorf("Python 3 is required to install the basedpyright language server: install Python, restart adOmnia and try again")
}
