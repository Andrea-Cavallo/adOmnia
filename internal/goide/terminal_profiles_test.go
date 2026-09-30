package goide

import (
	"runtime"
	"testing"
)

func TestTerminalProfilesDetectedAndResolved(t *testing.T) {
	profiles := ListTerminalProfiles()
	if len(profiles) == 0 {
		t.Skip("nessuna shell su questa macchina")
	}
	for _, profile := range profiles {
		t.Logf("%s\t%s\t%s %v", profile.ID, profile.Name, profile.Shell, profile.Arguments)
	}
	if runtime.GOOS == "windows" {
		if _, err := resolveTerminalProfile("cmd"); err != nil {
			t.Fatalf("cmd deve essere sempre disponibile su Windows: %v", err)
		}
	}
	first, err := resolveTerminalProfile("")
	if err != nil || first.ID != profiles[0].ID {
		t.Fatalf("il profilo predefinito deve essere il primo: %+v %v", first, err)
	}
	if _, err := resolveTerminalProfile(`C:\evil.exe`); err == nil {
		t.Fatal("un profilo non rilevato non deve essere accettato")
	}
}

func TestDecodeWSLOutput(t *testing.T) {
	utf16le := []byte{'U', 0, 'b', 0, 'u', 0, '\r', 0, '\n', 0, 'D', 0, 0x0, 0}
	if got := decodeWSLOutput(utf16le); got != "Ubu\r\nD\x00" {
		t.Fatalf("decode: %q", got)
	}
	if got := decodeWSLOutput([]byte("Ubuntu\n")); got != "Ubuntu\n" {
		t.Fatalf("utf-8 passthrough: %q", got)
	}
}
