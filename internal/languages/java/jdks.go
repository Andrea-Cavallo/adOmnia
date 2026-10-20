package java

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"adomnia/internal/ide/sdk"
)

// Un JDK scelto dall'utente vale per Run, Debug e Test dello stesso progetto: la stessa toolchain, altrimenti
// "compila con 21 e debugga con 17" è un bug difficile da vedere.

// DiscoverJDKs elenca i JDK installati nei posti noti (JAVA_HOME, PATH, cartelle di installazione di Windows,
// Linux e macOS, SDKMAN, `.jdks` di IntelliJ). Legge solo il file `release` di ogni JDK: nessun processo.
func DiscoverJDKs() []JDK {
	seen := map[string]bool{}
	var found []JDK
	add := func(home, source string) {
		if home == "" {
			return
		}
		if resolved, err := filepath.EvalSymlinks(home); err == nil {
			home = resolved
		}
		key := strings.ToLower(filepath.Clean(home))
		if seen[key] {
			return
		}
		binary := filepath.Join(home, "bin", sdk.ExecutableName("java"))
		if !isFile(binary) {
			return
		}
		seen[key] = true
		version := releaseVersion(home)
		found = append(found, JDK{Available: true, Binary: binary, Home: home, Source: source, Version: version, Major: Major(version)})
	}
	if home := strings.TrimSpace(os.Getenv("JAVA_HOME")); home != "" {
		add(home, "JAVA_HOME")
	}
	if binary, err := lookPath("java"); err == nil {
		if resolved, resolveErr := filepath.EvalSymlinks(binary); resolveErr == nil {
			binary = resolved
		}
		add(filepath.Dir(filepath.Dir(binary)), "PATH")
	}
	for _, root := range jdkRoots() {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			home := filepath.Join(root, entry.Name())
			if runtime.GOOS == "darwin" && isDirectory(filepath.Join(home, "Contents", "Home")) {
				home = filepath.Join(home, "Contents", "Home")
			}
			add(home, "installed")
		}
	}
	sort.SliceStable(found, func(i, j int) bool { return found[i].Major > found[j].Major })
	return found
}

// jdkRoots sono le cartelle che contengono un JDK per sottocartella.
func jdkRoots() []string {
	home, _ := os.UserHomeDir()
	roots := []string{
		filepath.Join(home, ".jdks"),
		filepath.Join(home, ".sdkman", "candidates", "java"),
		"/usr/lib/jvm", "/usr/java", "/Library/Java/JavaVirtualMachines",
	}
	for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
		if base == "" {
			continue
		}
		for _, vendor := range []string{"Java", "Eclipse Adoptium", "Microsoft", "Zulu", "Amazon Corretto", "BellSoft", "Semeru", "Eclipse Foundation"} {
			roots = append(roots, filepath.Join(base, vendor))
		}
	}
	return roots
}

var releaseVersionLine = regexp.MustCompile(`(?m)^JAVA_VERSION="([^"]+)"`)

// releaseVersion legge JAVA_VERSION dal file `release` che ogni JDK moderno porta nella sua radice.
func releaseVersion(home string) string {
	data, err := readLimited(filepath.Join(home, "release"))
	if err != nil {
		return ""
	}
	if match := releaseVersionLine.FindSubmatch(data); match != nil {
		return string(match[1])
	}
	return ""
}

// JavaEnvironment sono le variabili che fanno usare a Maven, Gradle e `java` il JDK scelto.
func JavaEnvironment(home string) []string {
	home = strings.TrimSpace(home)
	if home == "" {
		return nil
	}
	// os/exec toglie i duplicati dell'ambiente (anche "Path" su Windows): l'ultima voce vince.
	return []string{"JAVA_HOME=" + home, "PATH=" + filepath.Join(home, "bin") + string(os.PathListSeparator) + os.Getenv("PATH")}
}

// ValidJavaHome è vero se la cartella è un JDK/JRE (ha bin/java) e non contiene caratteri che rompono l'ambiente.
func ValidJavaHome(home string) bool {
	home = strings.TrimSpace(home)
	if home == "" || strings.ContainsAny(home, "\r\n\x00=") {
		return false
	}
	return isFile(filepath.Join(home, "bin", sdk.ExecutableName("java")))
}

var (
	pomJavaProperty  = regexp.MustCompile(`<(?:maven\.compiler\.release|maven\.compiler\.source|maven\.compiler\.target|java\.version|release)>\s*([0-9.]+)\s*<`)
	gradleSourceJava = regexp.MustCompile(`(?:sourceCompatibility|targetCompatibility)\s*=?\s*(?:JavaVersion\.VERSION_)?['"]?([0-9][0-9._]*)`)
	gradleToolchain  = regexp.MustCompile(`JavaLanguageVersion\.of\(\s*(\d+)\s*\)|languageVersion\s*=\s*JavaLanguageVersion\.of\(\s*(\d+)\s*\)`)
	gradleJvmTarget  = regexp.MustCompile(`jvmTarget\s*=?\s*['"]?([0-9][0-9.]*)`)
	// I moduli di un progetto multi-modulo: `<modules>` di Maven e `include` di Gradle.
	mavenModulesBlock = regexp.MustCompile(`(?s)<modules>(.*?)</modules>`)
	mavenModuleName   = regexp.MustCompile(`<module>\s*([^<]+?)\s*</module>`)
	gradleIncludeLine = regexp.MustCompile(`(?m)^\s*include\b[^\n]*`)
	gradleQuotedName  = regexp.MustCompile(`['"]([^'"]+)['"]`)
)

// maxBuildFiles limita la lettura del reactor: un progetto enorme non deve far leggere
// all'infinito i file di build.
const maxBuildFiles = 200

// RequiredJava è la versione maggiore di Java che il progetto dichiara (compiler release/source/target di
// Maven, toolchain o sourceCompatibility di Gradle); 0 se non la dichiara. Un progetto multi-modulo si
// legge per intero: la release si dichiara (anche) nei moduli, spesso non nell'aggregatore.
func RequiredJava(unitRoot string) int {
	best := 0
	for _, manifest := range projectBuildFiles(unitRoot) {
		data, err := readLimited(manifest)
		if err != nil {
			continue
		}
		if value := declaredJava(manifest, data); value > best {
			best = value
		}
	}
	return best
}

// declaredJava è la versione di Java dichiarata da un solo file di build.
func declaredJava(manifest string, data []byte) int {
	if strings.EqualFold(filepath.Base(manifest), "pom.xml") {
		return highestVersion(pomJavaProperty.FindAllSubmatch(data, -1))
	}
	best := highestVersion(gradleSourceJava.FindAllSubmatch(data, -1))
	for _, match := range gradleToolchain.FindAllSubmatch(data, -1) {
		for _, group := range match[1:] {
			if value, err := strconv.Atoi(string(group)); err == nil && value > best {
				best = value
			}
		}
	}
	if value := highestVersion(gradleJvmTarget.FindAllSubmatch(data, -1)); value > best {
		best = value
	}
	return best
}

// projectBuildFiles elenca i file di build da leggere: l'unità e i moduli che dichiara, sia Maven
// (`<modules>`) sia Gradle (`include` di settings.gradle). Non si segue mai un modulo fuori dalla
// cartella dell'unità e non si supera mai maxBuildFiles.
func projectBuildFiles(unitRoot string) []string {
	root := filepath.Clean(unitRoot)
	seen := map[string]bool{strings.ToLower(root): true}
	manifests := []string{}
	queue := []string{root}
	push := func(directories []string) {
		for _, directory := range directories {
			key := strings.ToLower(directory)
			if !seen[key] {
				seen[key] = true
				queue = append(queue, directory)
			}
		}
	}
	for len(queue) > 0 && len(manifests) < maxBuildFiles {
		directory := queue[0]
		queue = queue[1:]
		if manifest := filepath.Join(directory, "pom.xml"); isFile(manifest) {
			manifests = append(manifests, manifest)
			push(mavenModuleDirectories(directory, manifest, root))
			continue
		}
		build := ""
		for _, name := range gradleBuildFiles {
			if candidate := filepath.Join(directory, name); isFile(candidate) {
				build = candidate
				break
			}
		}
		if build == "" {
			continue
		}
		manifests = append(manifests, build)
		push(gradleModuleDirectories(directory, root))
	}
	return manifests
}

// mavenModuleDirectories sono le cartelle dei `<modules>` di un pom, dentro la cartella dell'unità.
func mavenModuleDirectories(directory, manifest, root string) []string {
	data, err := readLimited(manifest)
	if err != nil {
		return nil
	}
	block := mavenModulesBlock.FindSubmatch(data)
	if block == nil {
		return nil
	}
	var directories []string
	for _, match := range mavenModuleName.FindAllSubmatch(block[1], -1) {
		if module := containedDirectory(root, directory, string(match[1])); module != "" {
			directories = append(directories, module)
		}
	}
	return directories
}

// gradleModuleDirectories sono le cartelle dei progetti `include`d in settings.gradle(.kts).
// `include("a:b")` punta alla cartella `a/b`.
func gradleModuleDirectories(directory, root string) []string {
	var directories []string
	for _, name := range []string{"settings.gradle.kts", "settings.gradle"} {
		data, err := readLimited(filepath.Join(directory, name))
		if err != nil {
			continue
		}
		for _, line := range gradleIncludeLine.FindAll(data, -1) {
			for _, match := range gradleQuotedName.FindAllSubmatch(line, -1) {
				if module := containedDirectory(root, directory, strings.ReplaceAll(string(match[1]), ":", "/")); module != "" {
					directories = append(directories, module)
				}
			}
		}
		break
	}
	return directories
}

// containedDirectory risolve un nome di modulo dentro la cartella dell'unità: "" se è fuori.
func containedDirectory(root, from, name string) string {
	module := filepath.Clean(filepath.Join(from, filepath.FromSlash(strings.TrimSpace(name))))
	if !strings.HasPrefix(strings.ToLower(module), strings.ToLower(root)+string(os.PathSeparator)) {
		return ""
	}
	return module
}

func highestVersion(matches [][][]byte) int {
	best := 0
	for _, match := range matches {
		if value := Major(strings.ReplaceAll(string(match[1]), "_", ".")); value > best {
			best = value
		}
	}
	return best
}

// PickJDK sceglie fra i JDK installati quello da proporre: il più piccolo che soddisfa la versione richiesta
// (così non si compila con un JDK molto più nuovo del necessario); senza richiesta, il più nuovo.
func PickJDK(installed []JDK, required int) (JDK, bool) {
	var best JDK
	found := false
	for _, jdk := range installed {
		if jdk.Major == 0 || required > 0 && jdk.Major < required {
			continue
		}
		if !found || required > 0 && jdk.Major < best.Major || required == 0 && jdk.Major > best.Major {
			best, found = jdk, true
		}
	}
	return best, found
}

func isDirectory(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
