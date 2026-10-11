package startup

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// A real program: prints, connects to a "database" after 300 ms, listens after 600 ms.
func TestObserveRealProcess(t *testing.T) {
	db, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	go func() {
		for {
			if _, err := db.Accept(); err != nil {
				return
			}
		}
	}()
	dir := t.TempDir()
	source := `package main

import (
	"fmt"
	"net"
	"os"
	"time"
)

func main() {
	fmt.Println("loading config")
	time.Sleep(300 * time.Millisecond)
	conn, err := net.Dial("tcp", os.Args[1])
	if err != nil {
		panic(err)
	}
	defer conn.Close()
	fmt.Println("db connected")
	time.Sleep(300 * time.Millisecond)
	listener, _ := net.Listen("tcp", "127.0.0.1:0")
	fmt.Println("listening")
	for {
		c, err := listener.Accept()
		if err == nil {
			c.Close()
		}
	}
}
`
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(dir, "svc.exe")
	build := exec.Command("go", "build", "-o", exe, filepath.Join(dir, "main.go"))
	if output, err := build.CombinedOutput(); err != nil {
		t.Skipf("go build: %v %s", err, output)
	}
	command := exec.Command(exe, db.Addr().String())
	timeline, err := Observe(context.Background(), command, Options{Timeout: 20 * time.Second}, func(c *exec.Cmd) { _ = c.Process.Kill() })
	if err != nil {
		t.Fatal(err)
	}
	if !timeline.Ready || timeline.Port == 0 || timeline.ReadyMs < 500 {
		t.Fatalf("not ready: %+v", timeline)
	}
	dbPort := db.Addr().(*net.TCPAddr).Port
	var connectAt, listenAt float64
	for _, event := range timeline.Events {
		switch event.Kind {
		case "connect":
			if event.Detail == Kind(dbPort) {
				connectAt = event.AtMs
			}
		case "listen":
			listenAt = event.AtMs
		}
	}
	if connectAt == 0 || listenAt == 0 || connectAt > listenAt || len(timeline.Lines) < 2 {
		t.Fatalf("connect %.0f listen %.0f lines %v events %+v", connectAt, listenAt, timeline.Lines, timeline.Events)
	}
	if Kind(5432) != "PostgreSQL :5432" || Kind(dbPort) != ":"+strconv.Itoa(dbPort) {
		t.Fatal("Kind")
	}
}
