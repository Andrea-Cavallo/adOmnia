package java

import (
	"encoding/json"
	"fmt"
)

// DebugCommand executes a command on this project's Java language server.
type DebugCommand func(command string, arguments ...any) (json.RawMessage, error)

func ResolveDebugProject(rootURI string, options *DebugOptions, execute DebugCommand) error {
	var mains []struct {
		MainClass   string `json:"mainClass"`
		ProjectName string `json:"projectName"`
	}
	raw, err := execute(CommandResolveMainClass, rootURI)
	if err != nil {
		return err
	}
	if json.Unmarshal(raw, &mains) != nil {
		return fmt.Errorf("unexpected answer from the Java language server")
	}
	options.ProjectName = ""
	for _, main := range mains {
		if main.MainClass == options.MainClass {
			options.ProjectName = main.ProjectName
			break
		}
	}
	if options.ProjectName == "" {
		return fmt.Errorf("%s is not a main class of this project", options.MainClass)
	}
	return nil
}

func PrepareDebugRuntime(options *DebugOptions, execute DebugCommand) error {
	// Java Debug Server 0.53.1 expects a JSON string, not a JSON object.
	params, err := json.Marshal(struct {
		MainClass   string `json:"mainClass"`
		ProjectName string `json:"projectName"`
		IsFullBuild bool   `json:"isFullBuild"`
	}{MainClass: options.MainClass, ProjectName: options.ProjectName})
	if err != nil {
		return err
	}
	raw, err := execute(CommandBuildWorkspace, string(params))
	if err != nil {
		return fmt.Errorf("could not compile the Java project before debugging: %w", err)
	}
	var status int
	if json.Unmarshal(raw, &status) != nil {
		return fmt.Errorf("the Java language server did not return a build result; debug was not started")
	}
	switch status {
	case 1: // BuildWorkspaceStatus.SUCCEED
	case 3:
		return fmt.Errorf("Java compilation was cancelled; debug was not started")
	default:
		return fmt.Errorf("Java compilation failed for %s; fix the errors in Problems, then retry Debug", options.ProjectName)
	}
	var classpath [][]string
	raw, err = execute(CommandResolveClasspath, options.MainClass, options.ProjectName)
	if err != nil {
		return err
	}
	if json.Unmarshal(raw, &classpath) != nil || len(classpath) != 2 {
		return fmt.Errorf("unexpected classpath answer from the Java language server")
	}
	options.ModulePaths, options.ClassPaths = classpath[0], classpath[1]
	raw, err = execute(CommandResolveJavaExec, options.MainClass, options.ProjectName)
	if err != nil {
		return err
	}
	_ = json.Unmarshal(raw, &options.JavaExec)
	return nil
}
