package vault

import (
	"encoding/base64"
	"errors"
	"github.com/zalando/go-keyring"
	"strings"
	"testing"
)

func TestSealSurvivesLockAndRejectsTampering(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	oldGet, oldSet := keyGet, keySet
	defer func() { keyGet, keySet = oldGet, oldSet }()
	saved := ""
	keyGet = func(string, string) (string, error) {
		if saved == "" {
			return "", keyring.ErrNotFound
		}
		return saved, nil
	}
	keySet = func(_, _, value string) error { saved = value; return nil }
	ref, fallback, err := Seal("restart-secret")
	if err != nil || fallback {
		t.Fatalf("seal failed: %v", err)
	}
	if strings.Contains(ref, "restart-secret") {
		t.Fatal("plaintext exposed")
	}
	lockVault()
	value, err := Open(ref)
	if err != nil || value != "restart-secret" {
		t.Fatalf("open after lock failed: %v", err)
	}
	bytes, _ := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(ref, localPrefix))
	bytes[len(bytes)-1] ^= 1
	if _, err = Open(localPrefix + base64.RawStdEncoding.EncodeToString(bytes)); err == nil {
		t.Fatal("tampering accepted")
	}
	saved = base64.StdEncoding.EncodeToString(make([]byte, 32))
	if _, err = Open(ref); err == nil {
		t.Fatal("wrong key accepted")
	}
	keyGet = func(string, string) (string, error) { return "", errors.New("locked keyring") }
	if _, _, err = Seal("new-secret"); err == nil {
		t.Fatal("unavailable keyring must not silently replace an existing key")
	}
}

func TestFallbackKeySurvivesReload(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	oldGet, oldSet := keyGet, keySet
	defer func() { keyGet, keySet = oldGet, oldSet }()
	keyGet = func(string, string) (string, error) { return "", keyring.ErrNotFound }
	keySet = func(string, string, string) error { return errors.New("unavailable") }
	ref, fallback, err := Seal("fallback-secret")
	if err != nil || !fallback {
		t.Fatalf("fallback: %v", err)
	}
	value, err := Open(ref)
	if err != nil || value != "fallback-secret" {
		t.Fatalf("fallback reload: %v", err)
	}
}
