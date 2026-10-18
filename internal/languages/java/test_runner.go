package java

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"adomnia/internal/ide/run"
	idetesting "adomnia/internal/ide/testing"
)

// TestOptions sono le opzioni di LanguageOptions per i test Java. Hanno gli stessi nomi JSON della richiesta
// generica dell'host: Packages sono i file di test (relativi alla cartella dell'unità), Run è il nome del metodo.
type TestOptions struct {
	Packages []string `json:"packages"`
	Run      string   `json:"run"`
	// Coverage esegue i test con l'agente JaCoCo; il report si legge a fine run (JaCoCoReports).
	Coverage bool `json:"coverage"`
}

const maxTestClasses = 64

// methodName: un identificatore (con `*` come jolly), mai un'espressione regolare né testo libero che
// finirebbe nella riga di comando del build.
var methodName = regexp.MustCompile(`^[A-Za-z0-9_$*]+$`)

// testRoots sono le cartelle dei sorgenti di test: il nome del package è il percorso sotto di esse.
var testRoots = []string{"/src/test/java/", "/src/test/kotlin/", "/src/test/groovy/", "/src/test/scala/"}

// TestCommand esegue i test dell'unità con Maven o Gradle (wrapper del progetto prima dello strumento di
// sistema) e legge i report JUnit XML a fine build: stesso albero dei test degli altri linguaggi.
func (*Language) TestCommand(request idetesting.Request) (run.CommandSpec, idetesting.EventParser, error) {
	var options TestOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return run.CommandSpec{}, nil, fmt.Errorf("invalid test options: %w", err)
		}
	}
	unit, ok := unitIn(request.WorkingDirectory)
	if !ok {
		return run.CommandSpec{}, nil, fmt.Errorf("no pom.xml or build.gradle in %s", filepath.ToSlash(request.WorkingDirectory))
	}
	classes, err := testClasses(request, options)
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	tool, ok := resolveBuildTool(unit)
	if !ok {
		name := "Gradle"
		if unit.Kind == UnitMaven {
			name = "Maven"
		}
		return run.CommandSpec{}, nil, fmt.Errorf("neither the project wrapper nor %s was found: install it or add the wrapper to the project", name)
	}
	executable := tool.resolve(unit)
	arguments := testArguments(unit.Kind, classes, options.Run)
	if options.Coverage {
		var coverageErr error
		if arguments, coverageErr = withCoverage(unit.Kind, arguments); coverageErr != nil {
			return run.CommandSpec{}, nil, coverageErr
		}
	}
	if err := run.CheckBatchSafe(executable, arguments); err != nil {
		return run.CommandSpec{}, nil, err
	}
	spec := run.CommandSpec{
		Executable: executable, Arguments: arguments, WorkingDirectory: unit.Root, Environment: request.Environment,
		DisplayCommand: tool.Label + " " + strings.Join(arguments, " "),
	}
	return spec, newReportParser(request.Root, unit.Root), nil
}

// testClasses traduce i file di test scelti in nomi di classe, validando che restino dentro l'unità.
func testClasses(request idetesting.Request, options TestOptions) ([]string, error) {
	if len(options.Packages) > maxTestClasses {
		return nil, fmt.Errorf("too many test files: at most %d", maxTestClasses)
	}
	for _, method := range methodsOf(options.Run) {
		if !methodName.MatchString(method) {
			return nil, fmt.Errorf("invalid test method filter %q: use method names separated by commas", options.Run)
		}
	}
	if options.Run != "" && len(options.Packages) != 1 {
		return nil, fmt.Errorf("a method filter needs exactly one test file")
	}
	classes := make([]string, 0, len(options.Packages))
	for _, file := range options.Packages {
		if err := run.ValidateTarget(request.Root, request.WorkingDirectory, file); err != nil {
			return nil, err
		}
		classes = append(classes, className(file))
	}
	return classes, nil
}

// methodsOf separa il filtro `Run` in metodi: "a,b" riesegue due metodi della stessa classe.
func methodsOf(filter string) []string {
	if filter == "" {
		return nil
	}
	return strings.Split(filter, ",")
}

// className ricava la classe dal percorso del sorgente: `src/test/java/it/x/FooTest.java` → `it.x.FooTest`.
// Senza una cartella di test riconosciuta resta il nome semplice con un jolly sul package.
func className(file string) string {
	slashed := "/" + strings.TrimPrefix(filepath.ToSlash(file), "/")
	stem := strings.TrimSuffix(slashed, filepath.Ext(slashed))
	for _, root := range testRoots {
		if index := strings.Index(stem, root); index >= 0 {
			return strings.ReplaceAll(stem[index+len(root):], "/", ".")
		}
	}
	return "*." + filepath.Base(stem)
}

// testArguments: senza filtri esegue tutti i test dell'unità; con i filtri solo quelli scelti, senza fallire
// nei moduli che non li contengono. Gradle riesegue sempre (`cleanTest`): un test "up to date" non scriverebbe report.
func testArguments(kind string, classes []string, filter string) []string {
	methods := methodsOf(filter)
	if kind == UnitGradle {
		arguments := []string{"--console=plain", "cleanTest", "test"}
		for _, class := range classes {
			if len(methods) == 0 {
				arguments = append(arguments, "--tests", class)
			}
			for _, method := range methods {
				arguments = append(arguments, "--tests", class+"."+method)
			}
		}
		return arguments
	}
	arguments := []string{"-B", "test"}
	if len(classes) == 0 {
		return arguments
	}
	selection := strings.Join(classes, ",")
	if len(methods) > 0 {
		selection += "#" + strings.Join(methods, "+")
	}
	return append(arguments, "-Dtest="+selection, "-Dsurefire.failIfNoSpecifiedTests=false", "-DfailIfNoTests=false")
}

// withCoverage aggiunge l'agente JaCoCo agli argomenti di test: obiettivi del plugin per Maven, init script per Gradle.
func withCoverage(kind string, arguments []string) ([]string, error) {
	if kind == UnitGradle {
		script, err := jacocoInitScript()
		if err != nil {
			return nil, err
		}
		return append([]string{"-I", script}, arguments...), nil
	}
	return jacocoMavenArguments(arguments), nil
}
