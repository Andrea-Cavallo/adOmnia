package adomniacli

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"adomnia/internal/collectionfs"
	"adomnia/internal/oaslint"
)

func Lint(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("adomnia lint", flag.ContinueOnError)
	fs.SetOutput(stderr)
	reporter := fs.String("reporter", "text", "reporter: text or json")
	rulesetPath := fs.String("ruleset", "", "local adomnia.oaslint.json ruleset override")
	outPath := fs.String("out", "", "write reporter output to file")
	failOnWarn := fs.Bool("fail-on-warn", false, "return non-zero when warnings are present")
	flagArgs, target := splitLintArgs(args)
	if err := fs.Parse(flagArgs); err != nil {
		return 2
	}
	if strings.TrimSpace(target) == "" {
		fmt.Fprintln(stderr, "usage: adomnia lint <openapi.json|openapi.yaml|collection-folder> [--ruleset adomnia.oaslint.json] [--reporter text|json] [--out file] [--fail-on-warn]")
		return 2
	}
	ruleset, err := loadLintRuleset(*rulesetPath)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia lint: %v\n", err)
		return 2
	}
	findings, err := lintTarget(target, oaslint.Options{Ruleset: ruleset})
	if err != nil {
		fmt.Fprintf(stderr, "adomnia lint: %v\n", err)
		return 2
	}
	rendered, err := renderLint(findings, *reporter)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia lint: %v\n", err)
		return 2
	}
	if *outPath != "" {
		if err := os.WriteFile(*outPath, rendered, 0644); err != nil {
			fmt.Fprintf(stderr, "adomnia lint: write report: %v\n", err)
			return 2
		}
	} else {
		_, _ = stdout.Write(rendered)
	}
	if oaslint.HasErrors(findings) || (*failOnWarn && hasWarnings(findings)) {
		return 1
	}
	return 0
}

func splitLintArgs(args []string) ([]string, string) {
	flagArgs := []string{}
	target := ""
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "-fail-on-warn" || arg == "--fail-on-warn":
			flagArgs = append(flagArgs, arg)
		case arg == "-reporter" || arg == "--reporter" || arg == "-ruleset" || arg == "--ruleset" || arg == "-out" || arg == "--out":
			flagArgs = append(flagArgs, arg)
			if i+1 < len(args) {
				i++
				flagArgs = append(flagArgs, args[i])
			}
		case strings.HasPrefix(arg, "-reporter=") || strings.HasPrefix(arg, "--reporter=") || strings.HasPrefix(arg, "-ruleset=") || strings.HasPrefix(arg, "--ruleset=") || strings.HasPrefix(arg, "-out=") || strings.HasPrefix(arg, "--out="):
			flagArgs = append(flagArgs, arg)
		case target == "":
			target = arg
		default:
			flagArgs = append(flagArgs, arg)
		}
	}
	return flagArgs, target
}

func lintTarget(target string, opts oaslint.Options) ([]oaslint.Finding, error) {
	info, err := os.Stat(target)
	if err != nil {
		return nil, fmt.Errorf("read target: %w", err)
	}
	if info.IsDir() {
		collection, err := collectionfs.ImportCollection(target)
		if err != nil {
			return nil, fmt.Errorf("read collection folder: %w", err)
		}
		spec := strings.TrimSpace(collection.OpenAPISpec)
		if spec == "" {
			return nil, fmt.Errorf("collection folder has no openapiSpec in collection.json")
		}
		return lintSpecBytes([]byte(spec), "collection openapiSpec", opts)
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return nil, fmt.Errorf("read spec: %w", err)
	}
	return lintSpecBytes(data, target, opts)
}

func lintSpecBytes(data []byte, source string, opts oaslint.Options) ([]oaslint.Finding, error) {
	ext := strings.ToLower(filepath.Ext(source))
	if ext == ".json" {
		return oaslint.LintJSON(data, opts)
	}
	if ext == ".yaml" || ext == ".yml" {
		return oaslint.LintYAML(data, opts)
	}
	trimmed := strings.TrimSpace(string(data))
	if strings.HasPrefix(trimmed, "{") {
		return oaslint.LintJSON(data, opts)
	}
	return oaslint.LintYAML(data, opts)
}

func loadLintRuleset(path string) (oaslint.Ruleset, error) {
	if strings.TrimSpace(path) == "" {
		return oaslint.Ruleset{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return oaslint.Ruleset{}, fmt.Errorf("read ruleset: %w", err)
	}
	return oaslint.RulesetFromJSON(data)
}

func renderLint(findings []oaslint.Finding, reporter string) ([]byte, error) {
	switch reporter {
	case "json":
		data, err := oaslint.FormatJSON(findings)
		if err != nil {
			return nil, err
		}
		return append(data, '\n'), nil
	case "text", "cli", "":
		return []byte(oaslint.FormatText(findings)), nil
	default:
		return nil, fmt.Errorf("unknown reporter %q", reporter)
	}
}

func hasWarnings(findings []oaslint.Finding) bool {
	for _, item := range findings {
		if item.Severity == oaslint.SeverityWarn {
			return true
		}
	}
	return false
}
