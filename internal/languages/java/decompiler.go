package java

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

// Vineflower (the maintained Fernflower, Apache-2.0) turns class files back into Java source. It runs on the
// project JDK; adOmnia installs it once into its tools folder with a visible, confirmed command, and keeps the
// decompiled code in a read-only cache next to the extracted sources jars.

const (
	vineflowerVersion  = "1.10.1"
	vineflowerTask     = "java-decompiler"
	vineflowerFolder   = "vineflower"
	decompiledFolder   = "decompiled"
	libraryDecompiled  = "maven-decompiled"
	decompiledMarker   = ".adomnia-decompiled"
	maxDecompiledBytes = 512 << 20 // a jar this large is decompiled by hand, not on a click
)

var (
	vineflowerName = "vineflower-" + vineflowerVersion + ".jar"
	vineflowerURL  = "https://repo1.maven.org/maven2/org/vineflower/vineflower/" + vineflowerVersion + "/" + vineflowerName
)

// DecompilerJar is where Vineflower is installed in adOmnia's tools folder.
func DecompilerJar(toolsRoot string) string {
	return filepath.Join(toolsRoot, vineflowerFolder, vineflowerName)
}

// DecompilerInstallPlan is the one visible download of Vineflower, pinned, from Maven Central.
func DecompilerInstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, errors.New("adOmnia tools folder not configured")
	}
	folder := filepath.Join(toolsRoot, vineflowerFolder)
	chain := fmt.Sprintf("curl -fL --retry 2 -o %s %s", vineflowerName, vineflowerURL)
	executable, arguments := shellCommand(chain)
	return lsp.InstallPlan{
		Task: vineflowerTask, Title: "Install the Java decompiler?", Label: "Installing Vineflower…",
		Note:    "Downloads Vineflower " + vineflowerVersion + " (the maintained Fernflower decompiler, Apache-2.0, about 1 MB) from Maven Central into adOmnia's own tools folder. It turns the classes of a .jar back into readable Java source, in a read-only cache. The output appears in the Run console.",
		Command: chain, Executable: executable, Arguments: arguments, Directory: folder,
		Prepare:   func() error { return os.MkdirAll(folder, 0o755) },
		Languages: []string{ID},
	}, nil
}

// DecompiledJarDirectory is the cache folder of a decompiled jar: one per jar path, size and modification
// time, so a rebuilt jar is decompiled again.
func DecompiledJarDirectory(cacheRoot, jar string) (string, error) {
	info, err := os.Stat(jar)
	if err != nil {
		return "", fmt.Errorf("cannot read %s: %w", filepath.Base(jar), err)
	}
	key := filepath.Clean(jar) + "|" + strconv.FormatInt(info.Size(), 10) + "|" + strconv.FormatInt(info.ModTime().UnixNano(), 10)
	sum := sha256.Sum256([]byte(key))
	name := strings.TrimSuffix(filepath.Base(jar), filepath.Ext(jar))
	return filepath.Join(cacheRoot, decompiledFolder, hex.EncodeToString(sum[:])[:12]+"-"+safeName(name)), nil
}

// DecompiledLibraryDirectory is where a library without a sources jar is decompiled.
func DecompiledLibraryDirectory(cacheRoot, groupID, artifactID, version string) string {
	return filepath.Join(cacheRoot, libraryDecompiled, groupID, artifactID, version)
}

// Decompiled reports whether a cache folder holds a finished decompilation.
func Decompiled(directory string) bool {
	return SourcesExtracted(directory) && isFile(filepath.Join(directory, decompiledMarker))
}

// DecompileJob is one run of Vineflower: java -jar vineflower.jar <jar> <staging>.
type DecompileJob struct {
	Java       string
	Decompiler string
	Jar        string
	// Staging is an empty folder Vineflower writes into; Finish turns it into Directory.
	Staging   string
	Directory string
}

// NewDecompileJob checks the inputs and prepares the staging folder next to the cache folder.
func NewDecompileJob(java, decompiler, jar, directory string) (DecompileJob, error) {
	if !strings.EqualFold(filepath.Ext(jar), ".jar") && !strings.EqualFold(filepath.Ext(jar), ".war") {
		return DecompileJob{}, fmt.Errorf("%s is not a .jar", filepath.Base(jar))
	}
	info, err := os.Stat(jar)
	if err != nil || info.IsDir() {
		return DecompileJob{}, fmt.Errorf("%s is not a readable file", filepath.Base(jar))
	}
	if info.Size() > maxDecompiledBytes {
		return DecompileJob{}, fmt.Errorf("%s is larger than %d MB: decompile the classes you need instead", filepath.Base(jar), maxDecompiledBytes>>20)
	}
	if !isFile(decompiler) {
		return DecompileJob{}, errors.New("the Java decompiler is not installed: Java → Install Java Decompiler (Vineflower)")
	}
	if err := os.MkdirAll(filepath.Dir(directory), 0o755); err != nil {
		return DecompileJob{}, err
	}
	staging, err := os.MkdirTemp(filepath.Dir(directory), ".decompile-*")
	if err != nil {
		return DecompileJob{}, err
	}
	return DecompileJob{Java: java, Decompiler: decompiler, Jar: jar, Staging: staging, Directory: directory}, nil
}

// Arguments of the java command; -dgs decompiles generic signatures, -rsy hides synthetic members.
func (j DecompileJob) Arguments() []string {
	return []string{"-jar", j.Decompiler, "-dgs=1", "-rsy=1", "-log=WARN", j.Jar, j.Staging}
}

// Abort removes the staging folder of a failed run.
func (j DecompileJob) Abort() error { return os.RemoveAll(j.Staging) }

// Finish moves the result into the cache: Vineflower writes the sources of an archive as an archive with
// the same name, extracted here with the same limits as a sources jar; loose .java files are kept as they are.
func (j DecompileJob) Finish() error {
	defer func() { _ = os.RemoveAll(j.Staging) }() // a temporary folder of this run only
	archive := filepath.Join(j.Staging, filepath.Base(j.Jar))
	if isFile(archive) {
		if err := ExtractSources(archive, j.Directory); err != nil {
			return err
		}
	} else if err := moveDecompiledFolder(j.Staging, j.Directory); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(j.Directory, decompiledMarker), nil, 0o644)
}

func moveDecompiledFolder(staging, directory string) error {
	found := false
	_ = filepath.WalkDir(staging, func(path string, entry os.DirEntry, err error) error {
		if err == nil && !entry.IsDir() && strings.HasSuffix(entry.Name(), ".java") {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	if !found {
		return errors.New("the decompiler produced no Java source: the jar may hold no classes")
	}
	moved := staging + ".done"
	if err := os.Rename(staging, moved); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(moved, sourcesReadyMarker), nil, 0o644); err != nil {
		return err
	}
	_ = os.RemoveAll(directory) // an earlier, interrupted run
	return os.Rename(moved, directory)
}

func safeName(name string) string {
	return strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == ' ' {
			return '-'
		}
		return r
	}, name)
}
