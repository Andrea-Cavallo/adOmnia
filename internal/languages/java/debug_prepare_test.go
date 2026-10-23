package java

import (
	"adomnia/internal/jsonutil"
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDebugRuntimeBuildsMainBeforeLaunchingJava(t *testing.T) {
	javaBinary, err := exec.LookPath("java")
	if err != nil {
		t.Skip("java not installed")
	}
	javacBinary, err := exec.LookPath("javac")
	if err != nil {
		t.Skip("javac not installed")
	}
	root := filepath.Join(t.TempDir(), "module with spaces")
	source := filepath.Join(root, "src", "com", "wes", "openai", "SpringBootApp.java")
	output := filepath.Join(root, "target", "classes")
	if err := os.MkdirAll(filepath.Dir(source), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte(`package com.wes.openai; public class SpringBootApp { public static void main(String[] args) { System.out.println("debug-main-ready"); } }`), 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	options := DebugOptions{MainClass: "com.wes.openai.SpringBootApp", ProjectName: "fixture"}
	var commands []string
	err = PrepareDebugRuntime(&options, func(command string, args ...any) (jsonv1.RawMessage, error) {
		commands = append(commands, command)
		switch command {
		case "vscode.java.buildWorkspace":
			if err := os.MkdirAll(output, 0755); err != nil {
				return nil, err
			}
			if data, err := exec.CommandContext(ctx, javacBinary, "-g", "-d", output, source).CombinedOutput(); err != nil {
				t.Fatalf("javac: %v: %s", err, data)
			}
			return jsonv1.RawMessage(`1`), nil
		case CommandResolveClasspath:
			return jsonutil.Marshal([][]string{{}, {output}})
		case CommandResolveJavaExec:
			return jsonutil.Marshal(javaBinary)
		default:
			t.Fatalf("unexpected command: %s", command)
			return nil, nil
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := exec.CommandContext(ctx, options.JavaExec, "-cp", strings.Join(options.ClassPaths, string(os.PathListSeparator)), options.MainClass).CombinedOutput()
	if err != nil || !strings.Contains(string(data), "debug-main-ready") {
		t.Fatalf("debug main was launched without compiled classes (commands %v): %v\n%s", commands, err, data)
	}
	if commands[0] != "vscode.java.buildWorkspace" {
		t.Fatalf("must build before resolving runtime: %v", commands)
	}
}
func TestDebugRuntimeStopsWhenCompilationFails(t *testing.T) {
	for _, result := range []string{`0`, `2`, `3`, `100`, `null`, `"unexpected"`} {
		t.Run(result, func(t *testing.T) {
			options := DebugOptions{MainClass: "com.wes.openai.SpringBootApp", ProjectName: "app"}
			calls := 0
			err := PrepareDebugRuntime(&options, func(command string, args ...any) (jsonv1.RawMessage, error) {
				calls++
				if command != CommandBuildWorkspace || len(args) != 1 {
					t.Fatalf("must compile first: %s %v", command, args)
				}
				encoded, ok := args[0].(string)
				if !ok {
					t.Fatalf("server expects a JSON string, got %T", args[0])
				}
				var params struct {
					MainClass   string `json:"mainClass"`
					ProjectName string `json:"projectName"`
					IsFullBuild bool   `json:"isFullBuild"`
				}
				if json.Unmarshal([]byte(encoded), &params) != nil || params.MainClass != options.MainClass || params.ProjectName != "app" || params.IsFullBuild {
					t.Fatalf("build parameters: %s", encoded)
				}
				return jsonv1.RawMessage(result), nil
			})
			if err == nil || calls != 1 || options.ClassPaths != nil || options.JavaExec != "" {
				t.Fatalf("failed compilation must prevent launch resolution: options=%+v calls=%d err=%v", options, calls, err)
			}
		})
	}
}
