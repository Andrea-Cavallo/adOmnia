package devcontext

import (
	"path"
	"strings"
)

var skippedDirs = map[string]bool{
	".git": true, "node_modules": true, "vendor": true, "target": true, "build": true, "dist": true,
	".gradle": true, ".idea": true, ".venv": true, "__pycache__": true, ".next": true, "bin": true,
	"obj": true, "testdata": true,
}

// interesting reports whether any detector reads rel, and rel is not inside a
// skipped or hidden directory.
func interesting(rel string) bool {
	dir := path.Dir(rel)
	if dir != "." {
		for _, segment := range strings.Split(dir, "/") {
			if skippedDirs[segment] || strings.HasPrefix(segment, ".") {
				return false
			}
		}
	}
	base := path.Base(rel)
	switch {
	case base == "go.mod", isDotenv(base), isCompose(base), isMakefile(base):
		return true
	case strings.HasSuffix(base, "_test.go"):
		return false
	}
	switch path.Ext(base) {
	case ".go", ".proto", ".wsdl", ".yaml", ".yml", ".json", ".sql":
		return true
	}
	return false
}

// readable limits ReadContextFile to contract documents: never .env or code.
func readable(rel string) bool {
	switch path.Ext(rel) {
	case ".proto", ".wsdl", ".yaml", ".yml", ".json":
		return interesting(rel)
	}
	return false
}

func detectFile(rel string, data []byte, env map[string]string, hints AdapterHints) ([]Entity, []string) {
	var out []Entity
	var warnings []string
	add := func(entities []Entity, err error) {
		out = append(out, entities...)
		if err != nil {
			warnings = append(warnings, rel+": "+err.Error())
		}
	}
	base := path.Base(rel)
	switch {
	case base == "go.mod":
		add(detectGoMod(rel, data))
	case strings.HasSuffix(base, ".go"):
		add(detectGoFile(rel, data, hints))
	case isDotenv(base):
		add(detectDotenv(rel, data))
	case isCompose(base):
		add(detectCompose(rel, data, env))
	case isMakefile(base):
		add(detectMakefile(rel, data))
	case strings.HasSuffix(base, ".sql"):
		add(detectSQLMigration(rel, data))
	case strings.HasSuffix(base, ".proto"), strings.HasSuffix(base, ".wsdl"):
		add(detectContractFile(rel, data))
	default:
		add(detectOpenAPI(rel, data))
	}
	return out, warnings
}
