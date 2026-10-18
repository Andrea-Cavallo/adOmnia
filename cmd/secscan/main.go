// secscan scans the dependencies of a project (go.mod, pom.xml, build.gradle) against public advisories and
// exits non-zero when it finds something at or above a severity: a gate for CI, same engine as the app.
//
//	secscan -root . -fail-on high -format sarif -out secscan.sarif
//
// Only package coordinates leave the machine. Exit codes: 0 pass, 1 findings at or above -fail-on, 2 error.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"adomnia/internal/securityintel"
	"adomnia/internal/securityintel/standard"
)

func main() {
	os.Exit(run())
}

func run() int {
	root := flag.String("root", ".", "project folder")
	failOn := flag.String("fail-on", "high", "lowest severity that fails the build: critical, high, medium, low, informational or none")
	format := flag.String("format", "", "write a report: json, sarif, html, cyclonedx, spdx or vex")
	out := flag.String("out", "", "report file (default: secscan<ext> in the current folder)")
	offline := flag.Bool("offline", false, "use only the local advisory cache")
	ecosystems := flag.String("ecosystems", "", "comma-separated subset of: Go, Maven")
	flag.Parse()

	absolute, err := filepath.Abs(*root)
	if err != nil {
		return fail(err)
	}
	settings, err := securityintel.LoadWorkspaceSettings(absolute)
	if err != nil {
		return fail(err)
	}
	cacheDirectory, err := os.UserCacheDir()
	if err != nil {
		cacheDirectory = os.TempDir()
	}
	engine, _ := standard.Engine(filepath.Join(cacheDirectory, "adomnia-secscan"), settings.SourceEndpoints)
	request := securityintel.ScanRequest{
		Root:         absolute,
		Options:      securityintel.ResolveOptions{Offline: *offline || settings.Offline, IncludePluginDependencies: settings.IncludePluginDependencies, IncludeOptional: settings.IncludeOptional},
		Suppressions: settings.Suppressions,
	}
	for name := range strings.SplitSeq(*ecosystems, ",") {
		if name = strings.TrimSpace(name); name != "" {
			request.Ecosystems = append(request.Ecosystems, securityintel.Ecosystem(name))
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	report, err := engine.Scan(ctx, request)
	if err != nil {
		return fail(err)
	}
	if *format != "" {
		payload, err := securityintel.Export(report, *format)
		if err != nil {
			return fail(err)
		}
		target := *out
		if target == "" {
			target = "secscan" + securityintel.FileExtension(*format)
		}
		if err := os.WriteFile(target, payload, 0o644); err != nil {
			return fail(err)
		}
		fmt.Fprintln(os.Stderr, "report written to", target)
	}
	failures, err := securityintel.GateFailures(report, *failOn)
	if err != nil {
		return fail(err)
	}
	for _, finding := range failures {
		fmt.Printf("%s  %s  %s %s", strings.ToUpper(finding.Risk.Band), securityintel.CanonicalAdvisoryID(finding.Advisory), finding.Component.Name, finding.Component.Version)
		if finding.Remediation.FixedVersion != "" {
			fmt.Printf("  -> fixed in %s", finding.Remediation.FixedVersion)
		}
		fmt.Println()
	}
	fmt.Printf("%d findings, %d at or above %q\n", len(report.Findings), len(failures), *failOn)
	if len(failures) > 0 {
		return 1
	}
	return 0
}

func fail(err error) int {
	fmt.Fprintln(os.Stderr, "secscan:", err)
	return 2
}
