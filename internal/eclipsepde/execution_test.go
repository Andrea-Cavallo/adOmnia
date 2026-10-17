package eclipsepde

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseExecutionEnvironment(t *testing.T) {
	for in, want := range map[string]string{
		"JavaSE-1.6": "1.6",
		"J2SE-1.5":   "1.5",
		"JavaSE-1.8": "1.8",
	} {
		got, err := ParseExecutionEnvironment(in)
		if err != nil || got != want {
			t.Errorf("ParseExecutionEnvironment(%q) = %q, %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "JavaSE", "JavaSE-", "ciao"} {
		if _, err := ParseExecutionEnvironment(bad); err == nil {
			t.Errorf("ParseExecutionEnvironment(%q) should fail", bad)
		}
	}
}

func TestMaxClassVersion(t *testing.T) {
	if major, ok := MaxClassVersion("JavaSE-1.6"); !ok || major != 50 {
		t.Errorf("JavaSE-1.6 = %d ok=%v, want 50", major, ok)
	}
	if _, ok := MaxClassVersion("JavaSE-99.0"); ok {
		t.Error("unknown EE should not report a max class version")
	}
}

func TestClassFileVersion(t *testing.T) {
	class := classFileBytes(50)
	major, err := ClassFileVersion(class)
	if err != nil || major != 50 {
		t.Fatalf("major = %d err = %v", major, err)
	}
	if _, err := ClassFileVersion([]byte{1, 2, 3, 4, 5, 6, 7, 8}); err == nil {
		t.Error("bad magic should fail")
	}
	if _, err := ClassFileVersion([]byte{0xCA, 0xFE}); err == nil {
		t.Error("short file should fail")
	}
}

func TestCheckBytecodeLevel(t *testing.T) {
	root := t.TempDir()
	writeClassFile(t, filepath.Join(root, "bin", "com", "Acme.class"), 50) // Java 6: ok
	writeClassFile(t, filepath.Join(root, "bin", "com", "New.class"), 52)  // Java 8: too new
	writeClassFile(t, filepath.Join(root, "bin", "com", "Old.class"), 49)  // Java 5: ok

	problems, err := CheckBytecodeLevel(root, "JavaSE-1.6")
	if err != nil {
		t.Fatal(err)
	}
	if len(problems) != 1 {
		t.Fatalf("problems = %+v", problems)
	}
	if !strings.Contains(problems[0].File, "New.class") || problems[0].Major != 52 || problems[0].MaxMajor != 50 {
		t.Errorf("problem = %+v", problems[0])
	}
	if !strings.Contains(problems[0].String(), "above the execution environment") {
		t.Errorf("message = %s", problems[0].String())
	}

	// Unknown EE cannot be judged: explicit error, not silent acceptance.
	if _, err := CheckBytecodeLevel(root, "JavaSE-99.0"); err == nil {
		t.Error("unknown EE should fail")
	}
}

func TestReportExecutionEnvironmentProblems(t *testing.T) {
	root := t.TempDir()
	writeProject(t, root, "it.company.legacy",
		"Bundle-SymbolicName: it.company.legacy\nBundle-RequiredExecutionEnvironment: MysteryEE\n", nil)
	writeProject(t, root, "it.company.newee",
		"Bundle-SymbolicName: it.company.newee\nBundle-RequiredExecutionEnvironment: JavaSE-9.0\n", nil)
	ws, err := ImportWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	// Malformed EE: the JDK requirement cannot be determined at all.
	found := false
	for _, p := range ws.ProjectByName("it.company.legacy").Problems {
		if strings.Contains(p.Message, "unrecognized Bundle-RequiredExecutionEnvironment") {
			found = true
		}
	}
	if !found {
		t.Errorf("legacy problems = %+v", ws.ProjectByName("it.company.legacy").Problems)
	}
	// Syntactically valid but unknown level: informational, not an error.
	found = false
	for _, p := range ws.ProjectByName("it.company.newee").Problems {
		if p.Severity == "info" && strings.Contains(p.Message, "requires JavaSE-9.0") {
			found = true
		}
	}
	if !found {
		t.Errorf("newee problems = %+v", ws.ProjectByName("it.company.newee").Problems)
	}
}

// classFileBytes builds a minimal .class header with the given major version.
func classFileBytes(major uint16) []byte {
	data := make([]byte, 8)
	binary.BigEndian.PutUint32(data[0:4], 0xCAFEBABE)
	binary.BigEndian.PutUint16(data[6:8], major)
	return data
}

func writeClassFile(t *testing.T, path string, major uint16) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, classFileBytes(major), 0o644); err != nil {
		t.Fatal(err)
	}
}
