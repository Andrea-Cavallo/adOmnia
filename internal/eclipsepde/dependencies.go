package eclipsepde

import (
	"bufio"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// DependencyLookup answers "where does this class come from?" for an OSGi workspace: the
// bundles that export its package, the workspace bundles that use it, how each one gets
// it, and which ones use it without declaring it (a ClassNotFoundException at runtime).
type DependencyLookup struct {
	Query     string               `json:"query"`
	Package   string               `json:"package"`
	Class     string               `json:"class,omitempty"`
	JRE       bool                 `json:"jre"`
	Providers []PackageProvider    `json:"providers"`
	Consumers []DependencyConsumer `json:"consumers"`
	Missing   int                  `json:"missing"`
}

// PackageProvider is one bundle exporting the package.
type PackageProvider struct {
	SymbolicName  string `json:"symbolicName"`
	Version       string `json:"version"`
	Source        string `json:"source"`
	ExportVersion string `json:"exportVersion"`
}

// DependencyConsumer is one workspace bundle that declares or uses the package.
type DependencyConsumer struct {
	Bundle string `json:"bundle"`
	// Via is Import-Package, Require-Bundle, or empty when the manifest does not declare it.
	Via         string `json:"via,omitempty"`
	Requirement string `json:"requirement,omitempty"`
	// Provider is the bundle the resolver wires it to ("name version").
	Provider string `json:"provider,omitempty"`
	// File and Line are the first import of the class/package in the bundle's sources.
	File string `json:"file,omitempty"`
	Line int    `json:"line,omitempty"`
	// Problem explains why this consumer fails at runtime; empty when it is fine.
	Problem string `json:"problem,omitempty"`
}

// maxLookupFiles bounds the source scan of one bundle.
// ponytail: line scan of import statements, a fully qualified use without import is not seen.
const maxLookupFiles = 5000

// LookupDependency resolves a class (org.acme.Foo) or a package (org.acme) against the
// workspace and the target. Reading only.
func (r *ExplorerReport) LookupDependency(query string) *DependencyLookup {
	pkg, class := splitClassQuery(query)
	out := &DependencyLookup{Query: query, Package: pkg, Class: class, JRE: providedByJRE(pkg), Providers: []PackageProvider{}, Consumers: []DependencyConsumer{}}
	if pkg == "" {
		return out
	}
	providers := r.merged.ProvidersOf(pkg)
	for _, provider := range providers {
		out.Providers = append(out.Providers, PackageProvider{
			SymbolicName: provider.Entry.Bundle.SymbolicName, Version: provider.Entry.Bundle.Version.String(),
			Source: string(provider.Entry.Source), ExportVersion: provider.ExportVersion.String(),
		})
	}
	sort.SliceStable(out.Providers, func(i, j int) bool { return out.Providers[i].Source > out.Providers[j].Source })
	for _, project := range r.workspace.Bundles() {
		consumer, ok := r.consumerOf(project, pkg, class, providers, out.JRE)
		if !ok {
			continue
		}
		if consumer.Problem != "" {
			out.Missing++
		}
		out.Consumers = append(out.Consumers, consumer)
	}
	sort.SliceStable(out.Consumers, func(i, j int) bool {
		if (out.Consumers[i].Problem == "") != (out.Consumers[j].Problem == "") {
			return out.Consumers[i].Problem != ""
		}
		return out.Consumers[i].Bundle < out.Consumers[j].Bundle
	})
	return out
}

func (r *ExplorerReport) consumerOf(project *EclipseProject, pkg, class string, providers []Provider, jre bool) (DependencyConsumer, bool) {
	bundle := project.Bundle
	if exportsPackage(bundle, pkg) || ownsPackage(project, pkg+".X") {
		return DependencyConsumer{}, false
	}
	consumer := DependencyConsumer{Bundle: bundle.SymbolicName}
	consumer.File, consumer.Line = firstImport(project, r.Root, pkg, class)
	declared := false
	for _, clause := range bundle.ImportPackage {
		if clause.Name != pkg {
			continue
		}
		requirement := requirementOf("Import-Package", clause)
		label, entry := r.packageProvider(requirement, clause)
		consumer.Via, consumer.Requirement, declared = "Import-Package", requirement.String(), true
		if entry != nil {
			consumer.Provider = label
		} else if !clause.IsOptional() && !jre {
			consumer.Problem = "no bundle of the workspace or the target exports " + requirement.String()
		}
	}
	if !declared {
		for _, clause := range bundle.RequireBundle {
			for _, provider := range providers {
				if provider.Entry.Bundle.SymbolicName == clause.Name {
					consumer.Via, consumer.Requirement, consumer.Provider, declared = "Require-Bundle", clause.Name, labelOf(provider.Entry), true
				}
			}
		}
	}
	if !declared && consumer.File == "" {
		return DependencyConsumer{}, false
	}
	if !declared && !jre {
		consumer.Problem = "the sources import it but MANIFEST.MF neither imports " + pkg + " nor requires a bundle that exports it: ClassNotFoundException at runtime"
	}
	return consumer, true
}

func exportsPackage(bundle *Bundle, pkg string) bool {
	for _, clause := range bundle.ExportPackage {
		if clause.Name == pkg {
			return true
		}
	}
	return false
}

// splitClassQuery reads "org.acme.Foo", "org/acme/Foo.java" or "org.acme": a last segment
// starting with an upper-case letter is a class.
func splitClassQuery(query string) (pkg, class string) {
	name := strings.TrimSpace(query)
	name = strings.TrimSuffix(strings.TrimSuffix(name, ".java"), ".class")
	name = strings.Trim(strings.ReplaceAll(strings.ReplaceAll(name, "\\", "."), "/", "."), ".")
	dot := strings.LastIndex(name, ".")
	if dot > 0 && startsUpper(name[dot+1:]) {
		return name[:dot], name
	}
	return name, ""
}

func startsUpper(segment string) bool {
	for _, r := range segment {
		return unicode.IsUpper(r)
	}
	return false
}

// firstImport finds the first `import` of the class (or of any class of the package) in the
// bundle's source folders.
func firstImport(project *EclipseProject, root, pkg, class string) (string, int) {
	files := 0
	var foundFile string
	var foundLine int
	for _, folder := range project.sourceFolders() {
		_ = filepath.WalkDir(folder, func(path string, entry fs.DirEntry, err error) error {
			if foundFile != "" || files >= maxLookupFiles {
				return filepath.SkipAll
			}
			if err != nil {
				return filepath.SkipDir // unreadable folder: skip it, keep scanning the rest
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".java") {
				return nil
			}
			files++
			if line := importLine(path, pkg, class); line > 0 {
				foundFile, foundLine = relativeOrAbsolute(root, path), line
				return filepath.SkipAll
			}
			return nil
		})
		if foundFile != "" {
			break
		}
	}
	return foundFile, foundLine
}

func importLine(path, pkg, class string) int {
	file, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer func() { _ = file.Close() }() // read-only handle
	scanner := bufio.NewScanner(file)
	for line := 1; scanner.Scan(); line++ {
		text := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(text, "import ") {
			if strings.HasPrefix(text, "public ") || strings.HasPrefix(text, "class ") || strings.HasPrefix(text, "interface ") {
				return 0 // imports are over
			}
			continue
		}
		name := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(text, "import "), "static "), ";"))
		if importMatches(name, pkg, class) {
			return line
		}
	}
	return 0
}

func importMatches(name, pkg, class string) bool {
	if name == pkg+".*" {
		return true
	}
	if class != "" {
		return name == class || strings.HasPrefix(name, class+".")
	}
	rest, ok := strings.CutPrefix(name, pkg+".")
	return ok && startsUpper(rest)
}
