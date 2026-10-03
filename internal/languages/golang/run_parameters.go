package golang

import (
	idetesting "adomnia/internal/ide/testing"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

var platformNamePattern = regexp.MustCompile(`^[a-z0-9]{1,16}$`)
var subcommandPattern = regexp.MustCompile(`^[a-z][a-z0-9]{0,31}$`)

func ValidSubcommand(value string) bool { return subcommandPattern.MatchString(value) }

var profileFlags = map[string]string{"cpu": "-cpuprofile=cpu.pprof", "mem": "-memprofile=mem.pprof", "block": "-blockprofile=block.pprof", "mutex": "-mutexprofile=mutex.pprof", "trace": "-trace=trace.out"}

func ValidateRunOptions(kind string, options RunOptions) error {
	for label, value := range map[string]string{"GOOS": options.GOOS, "GOARCH": options.GOARCH} {
		if value != "" && !platformNamePattern.MatchString(value) {
			return fmt.Errorf("%s non valido: %q", label, value)
		}
	}
	if options.Profile != "" {
		if _, ok := profileFlags[options.Profile]; !ok {
			return fmt.Errorf("profilo non supportato: %q (cpu, mem, block, mutex, trace)", options.Profile)
		}
		if kind != "test" {
			return fmt.Errorf("il profiling è disponibile per le configurazioni di test")
		}
	}
	return nil
}

// ApplyRunOptions owns Go flags and Go-specific environment defaults.
func ApplyRunOptions(wd, kind string, options RunOptions, environment map[string]string) ([]string, error) {
	if err := ValidateRunOptions(kind, options); err != nil {
		return nil, err
	}
	args := append([]string(nil), options.GoArguments...)
	add := func(flag string) {
		if !slices.Contains(args, flag) {
			args = append([]string{flag}, args...)
		}
	}
	if options.GOOS != "" {
		environment["GOOS"] = options.GOOS
	}
	if options.GOARCH != "" {
		environment["GOARCH"] = options.GOARCH
	}
	goKind := slices.Contains([]string{"package", "files", "run", "build", "test"}, kind)
	if options.Race && goKind {
		add("-race")
		if _, set := environment["CGO_ENABLED"]; !set {
			environment["CGO_ENABLED"] = "1"
		}
	}
	if options.Coverage && goKind {
		add("-cover")
		if kind != "test" {
			directory := filepath.Join(wd, ".gocoverdata")
			if err := os.MkdirAll(directory, 0755); err != nil {
				return nil, fmt.Errorf("impossibile creare .gocoverdata: %w", err)
			}
			environment["GOCOVERDIR"] = directory
		}
	}
	if flag := profileFlags[options.Profile]; flag != "" && !slices.Contains(args, flag) {
		args = append(args, flag)
	}
	return args, nil
}

// ResolveTestLocations maps Go import paths and test2json source references to project paths.
func ResolveTestLocations(results []idetesting.TestResult, moduleDir, modulePath string) {
	for i := range results {
		directory := moduleDir
		if modulePath != "" && (results[i].Package == modulePath || strings.HasPrefix(results[i].Package, modulePath+"/")) {
			directory = filepath.ToSlash(filepath.Join(moduleDir, strings.TrimPrefix(strings.TrimPrefix(results[i].Package, modulePath), "/")))
		}
		if results[i].Name == "" {
			results[i].Directory = directory
		}
		if failure := results[i].Failure; failure != nil {
			copy := *failure
			base := directory
			file := filepath.ToSlash(failure.File)
			if results[i].BuildFailed || strings.Contains(file, "/") {
				base = moduleDir
			}
			copy.RelativePath = filepath.ToSlash(filepath.Clean(filepath.Join(base, file)))
			results[i].Failure = &copy
		}
	}
}
