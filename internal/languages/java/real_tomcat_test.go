package java

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A real Tomcat serves a source webapp published in place, and opens JPDA for the debugger.
// Opt-in: ADOMNIA_TEST_TOMCAT=<Tomcat home>.
func TestRealTomcatServesTheWebappInPlace(t *testing.T) {
	home := os.Getenv("ADOMNIA_TEST_TOMCAT")
	if home == "" {
		t.Skip("ADOMNIA_TEST_TOMCAT is not set")
	}
	module := filepath.Join(t.TempDir(), "billing")
	write(t, filepath.Join(module, "WebContent", "WEB-INF", "web.xml"), `<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee" version="3.1"/>`)
	write(t, filepath.Join(module, "WebContent", "hello.jsp"), `<%= "served " + (40 + 2) %>`)
	httpPort, debugPort := freePort(t), freePort(t)

	launch, err := TomcatCommand(module, TomcatOptions{CatalinaHome: home, HTTPPort: strconv.Itoa(httpPort)}, debugPort, os.Environ())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, launch.Spec.Executable, launch.Spec.Arguments...) // #nosec G204 -- the real launch under test
	command.Dir, command.Env = launch.Spec.WorkingDirectory, launch.Spec.Environment
	output := &strings.Builder{}
	command.Stdout, command.Stderr = output, output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = command.Process.Kill(); _ = command.Wait() }()

	// JPDA_SUSPEND=y: the JVM waits for a debugger. The JDWP handshake lets it go on.
	conn := dialWhenOpen(t, debugPort)
	defer conn.Close()
	if _, err := conn.Write([]byte("JDWP-Handshake")); err != nil {
		t.Fatal(err)
	}

	body := getWhenUp(t, launch.URL+"hello.jsp")
	if !strings.Contains(body, "served 42") || !strings.HasSuffix(launch.URL, "/billing/") {
		t.Fatalf("body = %q, output:\n%s", body, output)
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func dialWhenOpen(t *testing.T, port int) net.Conn {
	t.Helper()
	for deadline := time.Now().Add(60 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if conn, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(port)); err == nil {
			return conn
		}
	}
	t.Fatal("JPDA never opened")
	return nil
}

func getWhenUp(t *testing.T, url string) string {
	t.Helper()
	for deadline := time.Now().Add(60 * time.Second); time.Now().Before(deadline); time.Sleep(300 * time.Millisecond) {
		response, err := http.Get(url) // #nosec G107 -- local test server
		if err != nil {
			continue
		}
		data, _ := io.ReadAll(response.Body) // a short local page
		_ = response.Body.Close()
		if response.StatusCode == http.StatusOK {
			return string(data)
		}
	}
	t.Fatalf("%s never answered 200", url)
	return ""
}
