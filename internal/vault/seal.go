package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zalando/go-keyring"
)

const localPrefix = "vault:local:v1:"

func SealWithPassphrase(plaintext, passphrase string) (string, error) {
	encrypted, err := encryptWithAge(plaintext, passphrase)
	if err != nil {
		return "", err
	}
	return "vault:" + encrypted, nil
}

var sealMu sync.Mutex
var keyGet = keyring.Get
var keySet = keyring.Set

// The fallback is deliberately explicit: callers surface its warning. Never
// replace an existing unreadable key with a new one (that destroys credentials).
func masterKey() ([]byte, bool, error) {
	sealMu.Lock()
	defer sealMu.Unlock()
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, false, err
	}
	path := filepath.Join(dir, "adomnia", "database-master.key")
	marker := filepath.Join(filepath.Dir(path), "database-keyring.initialized")
	if data, err := os.ReadFile(path); err == nil {
		data, err = openKeyFile(data)
		if err != nil {
			return nil, true, errors.New("database encryption key is unreadable")
		}
		if len(data) != 32 {
			return nil, true, errors.New("invalid database encryption key")
		}
		return data, true, nil
	} else if !os.IsNotExist(err) {
		return nil, true, errors.New("database encryption key is unreadable")
	}
	encoded, err := keyGet("adomnia.database", "master-v1")
	if err == nil {
		data, e := base64.StdEncoding.DecodeString(encoded)
		if e != nil || len(data) != 32 {
			return nil, false, errors.New("invalid keychain encryption key")
		}
		return data, false, nil
	}
	if _, markerErr := os.Stat(marker); !os.IsNotExist(markerErr) {
		return nil, false, errors.New("system keychain unavailable; unlock it before saving credentials")
	}
	data := make([]byte, 32)
	if _, err = rand.Read(data); err != nil {
		return nil, false, err
	}
	if err = keySet("adomnia.database", "master-v1", base64.StdEncoding.EncodeToString(data)); err == nil {
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return nil, false, err
		}
		if err = os.WriteFile(marker, []byte("v1\n"), 0600); err != nil {
			return nil, false, err
		}
		return data, false, nil
	}
	// Keychain unavailable on first installation: restricted local fallback.
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, true, err
	}
	protected, err := protectKeyFile(data)
	if err != nil {
		return nil, true, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, true, err
	}
	_, err = file.Write(protected)
	closeErr := file.Close()
	if err != nil {
		return nil, true, err
	}
	if closeErr != nil {
		return nil, true, closeErr
	}
	return data, true, nil
}

func Seal(plaintext string) (string, bool, error) {
	if plaintext == "" {
		return "", false, nil
	}
	key, fallback, err := masterKey()
	if err != nil {
		return "", fallback, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fallback, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fallback, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", fallback, err
	}
	encrypted := gcm.Seal(nonce, nonce, []byte(plaintext), []byte(localPrefix))
	return localPrefix + base64.RawStdEncoding.EncodeToString(encrypted), fallback, nil
}

// Open is backend-only: automatic local seals do not depend on the passphrase
// Vault's inactivity lock. Existing age references still require an unlock.
func Open(ref string) (string, error) {
	if !strings.HasPrefix(ref, "vault:") {
		return ref, nil
	}
	if !strings.HasPrefix(ref, localPrefix) {
		vaultMu.RLock()
		identity := vaultIdentity
		unlocked := vaultUnlocked
		vaultMu.RUnlock()
		if !unlocked || identity == nil {
			return "", errors.New("Unlock Vault to use this legacy protected connection")
		}
		value, err := decryptWithIdentity(strings.TrimPrefix(ref, "vault:"), identity)
		if err != nil {
			return "", errors.New("could not open legacy database credential")
		}
		resetVaultTimer()
		return value, nil
	}
	key, _, err := masterKey()
	if err != nil {
		return "", err
	}
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	data, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(ref, localPrefix))
	if err != nil || len(data) < gcm.NonceSize()+gcm.Overhead() {
		return "", errors.New("invalid sealed credential")
	}
	value, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], []byte(localPrefix))
	if err != nil {
		return "", errors.New("could not open sealed credential on this installation")
	}
	return string(value), nil
}
