package java

import (
	"archive/zip"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Windows rifiuta una riga di comando oltre 32.767 caratteri: un'app Spring ha centinaia di jar nel classpath.
// Sotto questa soglia (con margine) il comando resta in chiaro, sopra si passa da un argfile o da un jar.
const maxCommandLineLength = 30_000

// LaunchSpec descrive l'avvio diretto di una classe: `java` con classpath/module path già risolti da JDT LS.
type LaunchSpec struct {
	JavaExec    string
	MainClass   string // "pkg.Classe", oppure "modulo/pkg.Classe" per un'app modulare
	ClassPaths  []string
	ModulePaths []string
	VMArgs      []string
	Args        []string
	// Major è la versione maggiore del JDK che esegue (8, 17, 21…); 0 = sconosciuta, trattata come moderna.
	Major int
	// TempDir riceve l'argfile o il jar del classpath; "" usa la cartella temporanea di sistema.
	TempDir string
}

// BuildLaunch compone eseguibile e argomenti. `cleanup` toglie il file temporaneo (mai nil).
func BuildLaunch(spec LaunchSpec) (executable string, arguments []string, cleanup func(), err error) {
	cleanup = func() {}
	if spec.JavaExec == "" || spec.MainClass == "" {
		return "", nil, cleanup, fmt.Errorf("a direct launch needs a java executable and a main class")
	}
	arguments = plainLaunchArguments(spec, spec.ClassPaths)
	if commandLength(spec.JavaExec, arguments) <= maxCommandLineLength {
		return spec.JavaExec, arguments, cleanup, nil
	}
	if spec.Major == 0 || spec.Major >= 9 {
		file, writeErr := writeArgFile(spec)
		if writeErr != nil {
			return "", nil, cleanup, writeErr
		}
		return spec.JavaExec, []string{"@" + file}, func() { _ = os.Remove(file) }, nil
	}
	// JDK 8 non conosce @argfile: il classpath lungo diventa un jar che contiene solo il manifest.
	jar, writeErr := writeClasspathJar(spec.ClassPaths, spec.TempDir)
	if writeErr != nil {
		return "", nil, cleanup, writeErr
	}
	return spec.JavaExec, plainLaunchArguments(spec, []string{jar}), func() { _ = os.Remove(jar) }, nil
}

func plainLaunchArguments(spec LaunchSpec, classPaths []string) []string {
	arguments := append([]string(nil), spec.VMArgs...)
	if len(spec.ModulePaths) > 0 {
		arguments = append(arguments, "--module-path", strings.Join(spec.ModulePaths, string(os.PathListSeparator)))
	}
	if len(classPaths) > 0 {
		arguments = append(arguments, "-cp", strings.Join(classPaths, string(os.PathListSeparator)))
	}
	if strings.Contains(spec.MainClass, "/") {
		arguments = append(arguments, "-m", spec.MainClass)
	} else {
		arguments = append(arguments, spec.MainClass)
	}
	return append(arguments, spec.Args...)
}

func commandLength(executable string, arguments []string) int {
	length := len(executable)
	for _, argument := range arguments {
		length += len(argument) + 3 // spazio e virgolette
	}
	return length
}

// argFileQuote: nell'argfile ogni argomento sta su una riga; fra virgolette il backslash e le virgolette si escapano.
func argFileQuote(argument string) string {
	if argument != "" && !strings.ContainsAny(argument, " \t\"'\\#\r\n") {
		return argument
	}
	replacer := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`, "\r", `\r`)
	return `"` + replacer.Replace(argument) + `"`
}

func writeArgFile(spec LaunchSpec) (string, error) {
	var lines []string
	for _, argument := range plainLaunchArguments(spec, spec.ClassPaths) {
		lines = append(lines, argFileQuote(argument))
	}
	file, err := os.CreateTemp(spec.TempDir, "adomnia-java-*.args")
	if err != nil {
		return "", fmt.Errorf("cannot write the Java argument file: %w", err)
	}
	defer file.Close()
	if _, err := file.WriteString(strings.Join(lines, "\n") + "\n"); err != nil {
		_ = os.Remove(file.Name())
		return "", fmt.Errorf("cannot write the Java argument file: %w", err)
	}
	return file.Name(), nil
}

// manifestLine spezza una riga del manifest a 72 byte: le righe di continuazione iniziano con uno spazio.
func manifestLine(text string) string {
	var out strings.Builder
	first := true
	for len(text) > 0 {
		limit := 72
		if !first {
			out.WriteString("\r\n ")
			limit = 71
		}
		first = false
		if len(text) < limit {
			limit = len(text)
		}
		out.WriteString(text[:limit])
		text = text[limit:]
	}
	return out.String()
}

// classPathURL è la voce di Class-Path: URL `file:` con percent-encoding, e "/" finale per le cartelle.
func classPathURL(path string) string {
	absolute, err := filepath.Abs(path)
	if err != nil {
		absolute = path
	}
	slashed := filepath.ToSlash(absolute)
	if !strings.HasPrefix(slashed, "/") {
		slashed = "/" + slashed
	}
	if info, statErr := os.Stat(absolute); statErr == nil && info.IsDir() && !strings.HasSuffix(slashed, "/") {
		slashed += "/"
	}
	return (&url.URL{Scheme: "file", Path: slashed}).String()
}

func writeClasspathJar(classPaths []string, directory string) (string, error) {
	entries := make([]string, len(classPaths))
	for i, path := range classPaths {
		entries[i] = classPathURL(path)
	}
	manifest := "Manifest-Version: 1.0\r\n" + manifestLine("Class-Path: "+strings.Join(entries, " ")) + "\r\n\r\n"
	file, err := os.CreateTemp(directory, "adomnia-classpath-*.jar")
	if err != nil {
		return "", fmt.Errorf("cannot write the classpath jar: %w", err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("META-INF/MANIFEST.MF")
	if err == nil {
		_, err = entry.Write([]byte(manifest))
	}
	if err == nil {
		err = writer.Close()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(file.Name())
		return "", fmt.Errorf("cannot write the classpath jar: %w", err)
	}
	return file.Name(), nil
}
