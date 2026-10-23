package run

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Opt-in because these tests execute the locally installed language runtimes.
func TestRealRuntimeConsoleInput(t *testing.T) {
	if os.Getenv("ADOMNIA_TEST_STDIN") != "1" {
		t.Skip("set ADOMNIA_TEST_STDIN=1 to test installed runtimes")
	}
	for _, fixture := range []struct {
		name, executable, kind, file, source string
		arguments                            []string
	}{
		{"Python", "python", "script", "input.py", "print('READY', flush=True)\nprint('INPUT:' + input(), flush=True)\nprint('EMPTY:' + str(len(input())), flush=True)\n", []string{"-u"}},
		{"Node", "node", "npm", "input.cjs", "const r=require('node:readline').createInterface({input:process.stdin}); let n=0; console.log('READY'); r.on('line', s=>{console.log(n++ === 0 ? 'INPUT:'+s : 'EMPTY:'+s.length); if(n===2) r.close();});", nil},
		{"Java", "java", "main", "Input.java", "import java.util.Scanner; class Input { public static void main(String[] args) { var s = new Scanner(System.in); System.out.println(\"READY\"); System.out.println(\"INPUT:\" + s.nextLine()); System.out.println(\"EMPTY:\" + s.nextLine().length()); } }", nil},
		{"Go", "go", "run", "input.go", "package main\nimport(\"bufio\";\"fmt\";\"os\")\nfunc main(){s:=bufio.NewScanner(os.Stdin);fmt.Println(\"READY\");s.Scan();fmt.Println(\"INPUT:\"+s.Text());s.Scan();fmt.Printf(\"EMPTY:%d\\n\",len(s.Text()))}", []string{"run"}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			executable, err := exec.LookPath(fixture.executable)
			if err != nil {
				t.Skipf("runtime unavailable: %v", err)
			}
			root := t.TempDir()
			file := filepath.Join(root, fixture.file)
			if err := os.WriteFile(file, []byte(fixture.source), 0600); err != nil {
				t.Fatal(err)
			}
			manager := NewProcessManager()
			t.Cleanup(manager.Shutdown)
			ready := make(chan struct{}, 1)
			finished := make(chan Execution, 1)
			var output strings.Builder
			manager.SetEventSink(func(kind string, execution Execution, payload any) {
				if chunk, ok := payload.(ProcessOutput); ok {
					output.WriteString(chunk.Text)
					if strings.Contains(chunk.Text, "READY") {
						select {
						case ready <- struct{}{}:
						default:
						}
					}
				}
				if kind == "run.finished" {
					finished <- execution
				}
			})
			execution, err := manager.Start(CommandSpec{Kind: fixture.kind, Executable: executable, Arguments: append(fixture.arguments, file), WorkingDirectory: root, Environment: os.Environ()})
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-ready:
			case <-finished:
				t.Fatalf("exited before input: %s", output.String())
			case <-time.After(time.Minute):
				t.Fatal("no input prompt")
			}
			select {
			case <-finished:
				t.Fatal("stdin closed before user input")
			case <-time.After(100 * time.Millisecond):
			}
			if err := manager.WriteStdin(execution.ID, "hello world\n\n"); err != nil {
				t.Fatal(err)
			}
			select {
			case result := <-finished:
				if result.ExitCode == nil || *result.ExitCode != 0 || !strings.Contains(output.String(), "INPUT:hello world") || !strings.Contains(output.String(), "EMPTY:0") {
					t.Fatalf("stdin failed: %+v\n%s", result, output.String())
				}
			case <-time.After(10 * time.Second):
				t.Fatal("input was not consumed")
			}
		})
	}
}
