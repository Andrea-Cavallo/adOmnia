package process

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// A real Go program that waits for os.Interrupt and prints during its graceful shutdown.
func TestInterruptReachesGoSignalHandler(t *testing.T) {
	dir := t.TempDir()
	program := `package main

import (
	"fmt"
	"os"
	"os/signal"
)

func main() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	fmt.Println("ready")
	<-signals
	fmt.Println("graceful shutdown")
}
`
	build := func(source, name string) string {
		file := filepath.Join(dir, name+".go")
		if err := os.WriteFile(file, []byte(source), 0o644); err != nil {
			t.Fatal(err)
		}
		exe := filepath.Join(dir, name+".exe")
		if output, err := exec.Command("go", "build", "-o", exe, file).CombinedOutput(); err != nil {
			t.Skipf("go build: %v %s", err, output)
		}
		return exe
	}
	target := build(program, "target")
	helper := ""
	if runtime.GOOS == "windows" {
		helper = build(InterruptHelperSource, "helper")
	}
	command := exec.Command(target)
	ConfigureInterruptible(command)
	stdout, _ := command.StdoutPipe()
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	lines := bufio.NewScanner(stdout)
	if !lines.Scan() || lines.Text() != "ready" {
		t.Fatalf("no ready line: %q", lines.Text())
	}
	if err := Interrupt(command.Process.Pid, helper); err != nil {
		_ = command.Process.Kill()
		t.Fatal(err)
	}
	done := make(chan string, 1)
	go func() {
		var rest []string
		for lines.Scan() {
			rest = append(rest, lines.Text())
		}
		done <- strings.Join(rest, "\n")
	}()
	select {
	case output := <-done:
		_ = command.Wait()
		if !strings.Contains(output, "graceful shutdown") {
			t.Fatalf("output after interrupt: %q", output)
		}
	case <-time.After(10 * time.Second):
		_ = command.Process.Kill()
		t.Fatal("the program did not receive the interrupt")
	}
}
