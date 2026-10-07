package remote

import (
	"bufio"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
)

func TestWSLPath(t *testing.T) {
	cases := map[string]string{
		`C:\Users\me\proj`:                   "/mnt/c/Users/me/proj",
		`d:\`:                                "/mnt/d",
		`\\wsl.localhost\Ubuntu\home\me\app`: "/home/me/app",
		`\\wsl$\Debian\srv`:                  "/srv",
	}
	for input, want := range cases {
		got, err := WSLPath(input)
		if err != nil || got != want {
			t.Errorf("WSLPath(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	if _, err := WSLPath("/already/linux"); err == nil {
		t.Error("a Linux path must not be translated")
	}
}

func TestValidateRejectsOptionLikeNamesAndRelativeDirectories(t *testing.T) {
	for _, target := range []Target{
		{Kind: KindSSH, Name: "-oProxyCommand=evil", Directory: "/srv"},
		{Kind: KindSSH, Name: "box", Directory: "relative"},
		{Kind: KindContainer, Name: "api", Directory: ""},
		{Kind: "ftp", Name: "x", Directory: "/x"},
	} {
		if err := target.Validate(); err == nil {
			t.Errorf("%+v should be rejected", target)
		}
	}
}

func TestMapLocalPathRewritesProjectPathsOnly(t *testing.T) {
	root := filepath.Join(t.TempDir(), "proj")
	cover := "-coverprofile=" + filepath.Join(root, "out", "c.out")
	if got := mapLocalPath(root, "/srv/proj", cover); got != "-coverprofile=/srv/proj/out/c.out" {
		t.Errorf("flag path = %q", got)
	}
	if got := mapLocalPath(root, "/srv/proj", root+"other"); got != root+"other" {
		t.Errorf("sibling folder must stay untouched, got %q", got)
	}
	if got := mapLocalPath(root, "/srv/proj", "./..."); got != "./..." {
		t.Errorf("relative pattern changed: %q", got)
	}
}

func TestWrapContainerKeepsSecretsOffTheCommandLine(t *testing.T) {
	root := filepath.Join(t.TempDir(), "proj")
	target := Target{Kind: KindContainer, Name: "dev", Directory: "/workspace"}
	command, err := target.Wrap(root, filepath.Join("C:", "go", "bin", "go.exe"), []string{"test", "-json", "./..."}, filepath.Join(root, "api"), map[string]string{"TOKEN": "s3cret"})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(command.Arguments, " ")
	if command.Executable != "docker" || strings.Contains(joined, "s3cret") {
		t.Fatalf("secret on the command line: %v", command.Arguments)
	}
	if !slices.Contains(command.Arguments, "TOKEN") || !slices.Contains(command.Environment, "TOKEN=s3cret") {
		t.Fatalf("variable not forwarded: %v / %v", command.Arguments, command.Environment)
	}
	script := command.Arguments[len(command.Arguments)-1]
	if !strings.Contains(script, "cd '/workspace/api'") || !strings.Contains(script, "'go' 'test' '-json' './...'") {
		t.Fatalf("script = %s", script)
	}
}

func TestWrapSSHQuotesTheWholeScript(t *testing.T) {
	root := filepath.Join(t.TempDir(), "proj")
	command, err := Target{Kind: KindSSH, Name: "build-box", Directory: "/home/me/it's"}.Wrap(root, "go", []string{"run", "."}, root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if command.Executable != "ssh" || !slices.Contains(command.Arguments, "BatchMode=yes") || command.Arguments[len(command.Arguments)-2] != "--" {
		t.Fatalf("ssh args = %v", command.Arguments)
	}
	if !strings.HasPrefix(command.Arguments[len(command.Arguments)-1], "sh -c '") {
		t.Fatalf("remote command = %s", command.Arguments[len(command.Arguments)-1])
	}
}

// Il guard script deve davvero eseguire il comando nella cartella e propagarne l'exit code.
func TestGuardScriptRunsAndPropagatesExitCode(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil || runtime.GOOS == "windows" {
		t.Skip("serve una sh POSIX")
	}
	dir := t.TempDir()
	command := exec.Command(sh, "-c", guardScript(dir, []string{"sh", "-c", "pwd; exit 3"}))
	command.Stdin = strings.NewReader("")
	output, err := command.Output()
	exit, ok := err.(*exec.ExitError)
	if !ok || exit.ExitCode() != 3 || !strings.Contains(string(output), filepath.Base(dir)) {
		t.Fatalf("output %q, err %v", output, err)
	}
}

func TestParseSSHConfigHosts(t *testing.T) {
	config := "Host *\n  User me\nHost build-box gpu  # comment\nHost=staging\nHost !bad web?\nMatch host x\n"
	got := ParseSSHConfigHosts(bufio.NewScanner(strings.NewReader(config)))
	if want := []string{"build-box", "gpu", "staging"}; !slices.Equal(got, want) {
		t.Fatalf("hosts = %v, want %v", got, want)
	}
}

func TestDecodeWSLOutput(t *testing.T) {
	utf16le := []byte{'U', 0, 'b', 0, 'u', 0, '\r', 0, '\n', 0, 'D', 0, 0x0, 0}
	if got := DecodeWSLOutput(utf16le); got != "Ubu\r\nD\x00" {
		t.Fatalf("decode: %q", got)
	}
	if got := DecodeWSLOutput([]byte("Ubuntu\n")); got != "Ubuntu\n" {
		t.Fatalf("utf-8 passthrough: %q", got)
	}
}
