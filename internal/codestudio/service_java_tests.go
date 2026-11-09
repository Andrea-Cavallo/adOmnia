package codestudio

import (
	"context"
	jsonv1 "encoding/json"
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// javaServerTestOptions completes the test options of an Ant or Eclipse module: those projects have no build
// tool that knows their classpath, so the Java language server resolves (and compiles) it, and the tests run
// on the JUnit Console Launcher installed in the tools folder.
func (s *Service) javaServerTestOptions(session Session, module string, raw []byte) ([]byte, error) {
	var options java.TestOptions
	if len(raw) > 0 {
		if err := jsonv1.Unmarshal(raw, &options); err != nil {
			return nil, fmt.Errorf("invalid test options: %w", err)
		}
	}
	class, ok := "", false
	if len(options.Packages) > 0 {
		class, ok = java.ServerTestClass(module, options.Packages[0])
	} else {
		class, ok = java.AnyServerTestClass(module)
	}
	if !ok {
		return nil, fmt.Errorf("no Java source in the source folders of this project")
	}
	if status := s.lsp.Status(session.ID, java.ID); status.State != LanguageServerReady {
		if _, err := s.StartProvidedLanguageServer(string(session.ID), java.ID); err != nil {
			return nil, fmt.Errorf("the Java language server resolves the classpath of Ant and Eclipse projects: %w", err)
		}
	}
	runtime := java.DebugOptions{MainClass: class, ProjectName: java.EclipseProjectName(module)}
	ctx, cancel := context.WithTimeout(context.Background(), javaDebugBuildTimeout)
	defer cancel()
	execute := func(command string, arguments ...any) (jsonv1.RawMessage, error) {
		return s.lsp.ExecuteCommand(ctx, session.ID, java.ID, command, arguments...)
	}
	// Once, not retried: a compile error is final for this run (fix it in Problems), like Debug.
	if err := java.PrepareDebugRuntime(&runtime, execute); err != nil {
		return nil, err
	}
	options.ClassPaths, options.JavaExec = append(runtime.ModulePaths, runtime.ClassPaths...), runtime.JavaExec
	options.Launcher = java.JUnitLauncherJar(s.toolsRoot)
	return jsonutil.Marshal(options)
}

// javaPluginTestOptions runs the tests of a PDE workspace inside Equinox (JUnit Plug-in Test) on the project
// JVM, the same one Run and Debug of the bundles use: the bundles must be built first.
func (s *Service) javaPluginTestOptions(session Session, raw []byte) ([]byte, error) {
	var options java.TestOptions
	if len(raw) > 0 {
		if err := jsonv1.Unmarshal(raw, &options); err != nil {
			return nil, fmt.Errorf("invalid test options: %w", err)
		}
	}
	jvm, err := s.osgiJVM(session)
	if err != nil {
		return nil, err
	}
	options.PluginTest = &java.PluginTestJVM{Java: jvm.Binary, Major: jvm.Major, Arch: jvm.Arch}
	return jsonutil.Marshal(options)
}
