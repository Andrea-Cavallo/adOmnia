package java

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"adomnia/internal/ide/lsp"
)

// Eclipse JDT LS: scaricato (dopo conferma) nella cartella strumenti di adOmnia, mai nel progetto.
const (
	installTask = "install-java-language-server"
	// jdtlsMinJava è la versione minima del JDK che *esegue* JDT LS (non quella del progetto).
	jdtlsMinJava = 21
	// jdtlsURL è un rilascio fisso: lo snapshot "latest" cambia il Java richiesto senza preavviso
	// (a un certo punto pretendeva Java 25), un milestone no. Per aggiornarlo si cambia l'URL e si
	// ricontrolla jdtlsMinJava.
	jdtlsURL = "https://download.eclipse.org/jdtls/milestones/1.60.0/jdt-language-server-1.60.0-202606262232.tar.gz"
	jdtlsDir = "jdtls"
	// debugPluginURL è il Java Debug Server (plugin di JDT LS, Microsoft): senza, JDT LS funziona ma non si debugga.
	debugPluginName = "com.microsoft.java.debug.plugin-0.53.1.jar"
	debugPluginURL  = "https://repo1.maven.org/maven2/com/microsoft/java/com.microsoft.java.debug.plugin/0.53.1/" + debugPluginName
)

// jdtlsHome è la cartella in cui si estrae JDT LS.
func jdtlsHome(toolsRoot string) string { return filepath.Join(toolsRoot, jdtlsDir) }

// debugBundle è il percorso del plugin di debug installato accanto a JDT LS ("" se manca).
func debugBundle(home string) string {
	matches, _ := filepath.Glob(filepath.Join(home, "bundles", "com.microsoft.java.debug.plugin-*.jar"))
	if len(matches) == 0 {
		return ""
	}
	return matches[0]
}

// launcherJar trova org.eclipse.equinox.launcher_*.jar: il nome porta la versione di Equinox.
func launcherJar(home string) string {
	matches, _ := filepath.Glob(filepath.Join(home, "plugins", "org.eclipse.equinox.launcher_*.jar"))
	if len(matches) == 0 {
		return ""
	}
	return matches[0]
}

// configDirectory è la cartella di configurazione di JDT LS per il sistema operativo.
func configDirectory(home string) string {
	name := "config_linux"
	switch runtime.GOOS {
	case "windows":
		name = "config_win"
	case "darwin":
		name = "config_mac"
	}
	if runtime.GOARCH == "arm64" && runtime.GOOS != "windows" {
		name += "_arm"
	}
	return filepath.Join(home, name)
}

// LocateServer implementa lsp.ServerProvider: JDT LS gestito da adOmnia più un JDK abbastanza
// recente per eseguirlo.
func (*Language) LocateServer(_, toolsRoot string) lsp.ServerInfo {
	info := lsp.ServerInfo{Language: ID, Name: "Eclipse JDT LS"}
	if toolsRoot == "" || launcherJar(jdtlsHome(toolsRoot)) == "" {
		info.Error = "Eclipse JDT LS is not installed: install it from the editor notice"
		return info
	}
	jdk := DetectJDK()
	switch {
	case debugBundle(jdtlsHome(toolsRoot)) == "":
		info.Error = "Eclipse JDT LS needs to be updated to add Java debugging: install it again from the editor notice"
	case !jdk.Available:
		info.Error = jdk.Problem + ": Eclipse JDT LS needs a JDK to run"
	case jdk.Major < jdtlsMinJava:
		info.Error = fmt.Sprintf("Eclipse JDT LS needs Java %d or newer to run (found %s): install a newer JDK or point JAVA_HOME to it", jdtlsMinJava, jdk.Version)
	default:
		info.Available, info.Binary, info.Source = true, jdk.Binary, "managed"
	}
	return info
}

// ServerSpec implementa lsp.ServerProvider. Il workspace di JDT LS (-data) sta nella cartella
// strumenti, uno per progetto: JDT LS non deve scrivere nella cartella dell'utente.
func (l *Language) ServerSpec(root, toolsRoot string) (lsp.ServerSpec, error) {
	info := l.LocateServer(root, toolsRoot)
	if !info.Available {
		return lsp.ServerSpec{}, fmt.Errorf("%s", info.Error)
	}
	home := jdtlsHome(toolsRoot)
	data := filepath.Join(toolsRoot, "jdtls-data", workspaceKey(root))
	if err := os.MkdirAll(data, 0o755); err != nil {
		return lsp.ServerSpec{}, fmt.Errorf("could not prepare the JDT LS workspace: %w", err)
	}
	return lsp.ServerSpec{
		Language: ID, Name: info.Name, Binary: info.Binary,
		Arguments: []string{
			"-Declipse.application=org.eclipse.jdt.ls.core.id1", "-Dosgi.bundles.defaultStartLevel=4",
			"-Declipse.product=org.eclipse.jdt.ls.core.product", "-Dlog.level=NONE", "-Xmx1G",
			"--add-modules=ALL-SYSTEM", "--add-opens", "java.base/java.util=ALL-UNNAMED", "--add-opens", "java.base/java.lang=ALL-UNNAMED",
			"-jar", launcherJar(home), "-configuration", configDirectory(home), "-data", data,
		},
		// Il Java Debug Server entra in JDT LS come bundle: così "vscode.java.startDebugSession" esiste.
		InitializationOptions: map[string]any{"bundles": []string{debugBundle(home)}},
		Configuration:         func() any { return map[string]any{} },
		WatchesFile:           watchesFile,
	}, nil
}

// workspaceKey è stabile per cartella: stesso progetto, stesso workspace JDT LS (indici già pronti).
func workspaceKey(root string) string {
	key := filepath.Clean(root)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		key = strings.ToLower(key)
	}
	sum := sha1.Sum([]byte(key))
	return filepath.Base(key) + "-" + hex.EncodeToString(sum[:4])
}

// watchesFile: sorgenti e file di build che JDT LS deve rileggere quando cambiano su disco.
func watchesFile(path string) bool {
	switch filepath.Base(path) {
	case "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts":
		return true
	}
	return strings.EqualFold(filepath.Ext(path), ".java")
}

// InstallPlan implementa lsp.ServerProvider. Il download è un solo comando visibile: curl e tar sono
// presenti in Windows 10+, macOS e Linux; i nomi di file sono relativi alla cartella di lavoro, così
// il comando non ha percorsi da quotare.
func (*Language) InstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("adOmnia tools folder not configured")
	}
	if jdk := DetectJDK(); !jdk.Available {
		return lsp.InstallPlan{}, fmt.Errorf("%s: install a JDK (%d+) first, then Eclipse JDT LS", jdk.Problem, jdtlsMinJava)
	}
	home := jdtlsHome(toolsRoot)
	chain := fmt.Sprintf("curl -fL --retry 2 -o jdtls.tar.gz %s && tar -xzf jdtls.tar.gz && %s && curl -fL --retry 2 --create-dirs -o bundles/%s %s", jdtlsURL, removeCommand("jdtls.tar.gz"), debugPluginName, debugPluginURL)
	executable, arguments := shellCommand(chain)
	return lsp.InstallPlan{
		Task: installTask, Title: "Install Eclipse JDT LS?", Label: "Installing JDT LS…",
		Note:       "Downloads Eclipse JDT LS 1.60.0 (about 50 MB) from download.eclipse.org and the Java Debug Server (3 MB) from Maven Central into adOmnia's own tools folder, never into your project. The output appears in the Run console.",
		Command:    chain,
		Executable: executable, Arguments: arguments, Directory: home,
		// Un'installazione interrotta lascia file a metà: si riparte sempre da una cartella vuota.
		Prepare: func() error {
			if err := os.RemoveAll(home); err != nil {
				return err
			}
			return os.MkdirAll(home, 0o755)
		},
		Languages: []string{ID},
	}, nil
}

// shellCommand esegue una catena `a && b` con la shell del sistema.
func shellCommand(chain string) (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd", []string{"/c", chain}
	}
	return "sh", []string{"-c", chain}
}

func removeCommand(file string) string {
	if runtime.GOOS == "windows" {
		return "del " + file
	}
	return "rm " + file
}
