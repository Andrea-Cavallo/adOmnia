package rust

import (
	"strings"
	"testing"
)

// Un build MSVC senza Build Tools finisce con un errore che non dice cosa installare: la riga va
// riconosciuta e spiegata una sola volta per esecuzione (RS-2.2, RS-M10).
func TestRunConsoleExplainsTheMissingMSVCLinkerOnce(t *testing.T) {
	console := runConsole(workspacePaths{})
	text, handled := console("error: linker `link.exe` not found")
	if !handled {
		t.Fatal("the missing linker error is not recognized")
	}
	if !strings.HasPrefix(text, "error: linker `link.exe` not found") {
		t.Fatalf("the original line is not kept: %q", text)
	}
	if !strings.Contains(text, missingLinkerExplanation) {
		t.Fatalf("the missing linker is not explained: %q", text)
	}
	second, handled := console("LINK : fatal error LNK1181: cannot open input file 'kernel32.lib'")
	if !handled {
		t.Fatal("the missing Windows SDK error is not recognized")
	}
	if strings.Contains(second, missingLinkerExplanation) {
		t.Fatalf("the explanation is repeated: %q", second)
	}
}

// Le forme reali di rustc 1.99 su Windows MSVC: senza linker nel PATH, e con un linker
// configurato che non esiste (percorso con spazi compreso).
func TestRunConsoleMatchesTheRealRustcLines(t *testing.T) {
	for _, line := range []string{
		"error: linker `link.exe` not found",
		"error: linker `C:\\nope\\link.exe` not found",
		"error: linker `C:\\Program Files\\Microsoft Visual Studio\\link.exe` not found",
		"  = note: the msvc targets depend on the msvc linker",
	} {
		want := strings.Contains(line, "not found")
		if got := missingLinkerLine.MatchString(line); got != want {
			t.Fatalf("%q matched = %v, want %v", line, got, want)
		}
	}
}

// Il linker presente ma senza SDK è lo stesso problema visto dal linker, non da rustc.
func TestRunConsoleRecognizesTheLK1181Form(t *testing.T) {
	missing := "LINK : fatal error LNK1181: cannot open input file 'kernel32.lib'"
	if !missingLinkerLine.MatchString(missing) {
		t.Fatalf("the LNK1181 line is not recognized: %q", missing)
	}
	text, handled := runConsole(workspacePaths{})(missing)
	if !handled || !strings.Contains(text, missingLinkerExplanation) {
		t.Fatalf("LNK1181 is not explained: %q", text)
	}
}

// Un errore di compilazione normale non deve ricevere la spiegazione del linker.
func TestRunConsoleLeavesCompileErrorsAlone(t *testing.T) {
	console := runConsole(workspacePaths{})
	for _, line := range []string{
		"error[E0308]: mismatched types",
		"error: could not compile `api` (bin \"api\") due to 1 previous error",
		"error: linker command failed with exit code 1",
		"thread 'main' panicked at src/main.rs:3:5",
	} {
		text, _ := console(line)
		if strings.Contains(text, missingLinkerExplanation) {
			t.Fatalf("a normal build error is explained as a missing linker: %q", line)
		}
	}
}
