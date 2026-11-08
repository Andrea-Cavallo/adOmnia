package java

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDecompilerInstallAndCacheKey(t *testing.T) {
	plan, err := DecompilerInstallPlan(t.TempDir())
	if err != nil || !strings.Contains(plan.Command, vineflowerURL) || plan.Task != vineflowerTask {
		t.Fatalf("plan = %+v, %v", plan, err)
	}
	jar := filepath.Join(t.TempDir(), "legacy-core.jar")
	writeZip(t, jar, map[string]string{"a/A.class": "x"})
	cache := t.TempDir()
	first, err := DecompiledJarDirectory(cache, jar)
	if err != nil || !strings.HasSuffix(filepath.Base(first), "-legacy-core") {
		t.Fatalf("directory = %q, %v", first, err)
	}
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(jar, later, later); err != nil {
		t.Fatal(err)
	}
	if second, _ := DecompiledJarDirectory(cache, jar); second == first {
		t.Fatal("a rebuilt jar is decompiled again")
	}
}

func TestDecompileJobChecksItsInputs(t *testing.T) {
	folder := t.TempDir()
	notJar := filepath.Join(folder, "notes.txt")
	write(t, notJar, "x")
	jar := filepath.Join(folder, "lib.jar")
	writeZip(t, jar, map[string]string{"A.class": "x"})
	directory := filepath.Join(t.TempDir(), "out")
	if _, err := NewDecompileJob("java", filepath.Join(folder, "missing.jar"), notJar, directory); err == nil || !strings.Contains(err.Error(), "not a .jar") {
		t.Fatalf("err = %v", err)
	}
	if _, err := NewDecompileJob("java", filepath.Join(folder, "missing.jar"), jar, directory); err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("err = %v", err)
	}
}

func TestDecompileJobFinishesBothOutputLayouts(t *testing.T) {
	folder := t.TempDir()
	decompiler := filepath.Join(folder, vineflowerName)
	write(t, decompiler, "x")
	jar := filepath.Join(folder, "lib.jar")
	writeZip(t, jar, map[string]string{"a/A.class": "x"})

	archived := filepath.Join(t.TempDir(), "archived")
	job, err := NewDecompileJob("java", decompiler, jar, archived)
	if err != nil {
		t.Fatal(err)
	}
	if args := strings.Join(job.Arguments(), " "); !strings.Contains(args, "-jar "+decompiler) || !strings.HasSuffix(args, jar+" "+job.Staging) {
		t.Fatalf("arguments = %s", args)
	}
	writeZip(t, filepath.Join(job.Staging, "lib.jar"), map[string]string{"a/A.java": "package a; class A {}", "../evil.java": "x"})
	if err := job.Finish(); err == nil {
		t.Fatal("an archive entry escaping the cache must be refused")
	}
	job, _ = NewDecompileJob("java", decompiler, jar, archived)
	writeZip(t, filepath.Join(job.Staging, "lib.jar"), map[string]string{"a/A.java": "package a; class A {}"})
	if err := job.Finish(); err != nil || !Decompiled(archived) || !isFile(filepath.Join(archived, "a", "A.java")) {
		t.Fatalf("archive layout: %v", err)
	}

	loose := filepath.Join(t.TempDir(), "loose")
	job, _ = NewDecompileJob("java", decompiler, jar, loose)
	write(t, filepath.Join(job.Staging, "a", "A.java"), "package a; class A {}")
	if err := job.Finish(); err != nil || !Decompiled(loose) || !isFile(filepath.Join(loose, "a", "A.java")) {
		t.Fatalf("folder layout: %v", err)
	}

	empty := filepath.Join(t.TempDir(), "empty")
	job, _ = NewDecompileJob("java", decompiler, jar, empty)
	if err := job.Finish(); err == nil || Decompiled(empty) {
		t.Fatal("no Java source is an error, not an empty cache")
	}
}

// The real decompiler on a real class. Opt-in: ADOMNIA_TEST_VINEFLOWER=<vineflower jar> (and a JDK on PATH).
func TestRealVineflowerDecompilesAClass(t *testing.T) {
	decompiler := os.Getenv("ADOMNIA_TEST_VINEFLOWER")
	if decompiler == "" {
		t.Skip("ADOMNIA_TEST_VINEFLOWER is not set")
	}
	work := t.TempDir()
	write(t, filepath.Join(work, "src", "acme", "Greeter.java"), "package acme; public class Greeter { public String greet(String name) { return \"hi \" + name; } }")
	for _, command := range [][]string{
		{"javac", "-d", filepath.Join(work, "classes"), filepath.Join(work, "src", "acme", "Greeter.java")},
		{"jar", "cf", filepath.Join(work, "greeter.jar"), "-C", filepath.Join(work, "classes"), "."},
	} {
		if output, err := exec.Command(command[0], command[1:]...).CombinedOutput(); err != nil { // #nosec G204 -- test tools
			t.Fatalf("%v: %v\n%s", command, err, output)
		}
	}
	directory := filepath.Join(t.TempDir(), "out")
	job, err := NewDecompileJob("java", decompiler, filepath.Join(work, "greeter.jar"), directory)
	if err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command(job.Java, job.Arguments()...).CombinedOutput(); err != nil { // #nosec G204 -- the real decompiler under test
		t.Fatalf("%v\n%s", err, output)
	}
	if err := job.Finish(); err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join(directory, "acme", "Greeter.java"))
	if err != nil || !strings.Contains(string(source), `return "hi " + name`) {
		t.Fatalf("source = %s, %v", source, err)
	}
}
