// vault.go — local secret vault using age encryption.
// Tokens, API keys, and passwords are encrypted at rest with a passphrase.
// In-memory key is held only while the vault is unlocked.

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"filippo.io/age"
	bolt "go.etcd.io/bbolt"
)

var (
	vaultMu       sync.RWMutex
	vaultUnlocked bool
	vaultIdentity age.Identity
	vaultTimeout  = 30 * time.Minute
	vaultTimer    *time.Timer
)

func resetVaultTimer() {
	if vaultTimer != nil {
		vaultTimer.Stop()
	}
	vaultTimer = time.AfterFunc(vaultTimeout, func() {
		lockVault()
		log.Println("[vault] auto-locked after inactivity")
	})
}

func lockVault() {
	vaultMu.Lock()
	defer vaultMu.Unlock()
	vaultUnlocked = false
	vaultIdentity = nil
	if vaultTimer != nil {
		vaultTimer.Stop()
	}
}

func encryptWithAge(plaintext, passphrase string) (string, error) {
	recipient, err := age.NewScryptRecipient(passphrase)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	w, err := age.Encrypt(&buf, recipient)
	if err != nil {
		return "", err
	}
	if _, err := w.Write([]byte(plaintext)); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func decryptWithAge(cipherB64, passphrase string) (string, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(cipherB64)
	if err != nil {
		return "", err
	}

	identity, err := age.NewScryptIdentity(passphrase)
	if err != nil {
		return "", err
	}

	r, err := age.Decrypt(bytes.NewReader(ciphertext), identity)
	if err != nil {
		return "", err
	}
	plaintext, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// --- HTTP handlers ---

func vaultStatusHandler(w http.ResponseWriter, r *http.Request) {
	vaultMu.RLock()
	defer vaultMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"unlocked": vaultUnlocked,
	})
}

func vaultUnlockHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Passphrase string `json:"passphrase"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if req.Passphrase == "" {
		http.Error(w, "passphrase required", http.StatusBadRequest)
		return
	}

	// Derive the identity from the passphrase via scrypt
	identity, err := age.NewScryptIdentity(req.Passphrase)
	if err != nil {
		http.Error(w, "failed to derive key", http.StatusInternalServerError)
		return
	}

	vaultMu.Lock()
	vaultUnlocked = true
	vaultIdentity = identity
	vaultMu.Unlock()

	resetVaultTimer()
	log.Println("[vault] unlocked")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func vaultLockHandler(w http.ResponseWriter, r *http.Request) {
	lockVault()
	log.Println("[vault] locked manually")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func vaultEncryptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Plaintext  string `json:"plaintext"`
		Passphrase string `json:"passphrase"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if req.Plaintext == "" || req.Passphrase == "" {
		http.Error(w, "plaintext and passphrase required", http.StatusBadRequest)
		return
	}

	ciphertext, err := encryptWithAge(req.Plaintext, req.Passphrase)
	if err != nil {
		http.Error(w, "encryption failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":         true,
		"ciphertext": ciphertext,
	})
}

func vaultDecryptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Ciphertext string `json:"ciphertext"`
		Passphrase string `json:"passphrase"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if req.Ciphertext == "" || req.Passphrase == "" {
		http.Error(w, "ciphertext and passphrase required", http.StatusBadRequest)
		return
	}

	plaintext, err := decryptWithAge(req.Ciphertext, req.Passphrase)
	if err != nil {
		http.Error(w, "decryption failed: invalid passphrase or corrupted data", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":        true,
		"plaintext": plaintext,
	})
}

// Export workspace encrypted with age passphrase
func vaultExportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Passphrase string `json:"passphrase"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if req.Passphrase == "" {
		http.Error(w, "passphrase required", http.StatusBadRequest)
		return
	}

	// Gather workspace from bbolt
	export := map[string]string{}
	if storeDB != nil {
		_ = storeDB.View(func(tx *bolt.Tx) error {
			for _, bucket := range storeBuckets {
				b := tx.Bucket([]byte(bucket))
				if b == nil {
					continue
				}
				c := b.Cursor()
				for k, v := c.First(); k != nil; k, v = c.Next() {
					export[bucket+"/"+string(k)] = string(v)
				}
			}
			return nil
		})
	}

	if len(export) == 0 {
		http.Error(w, "nothing to export", http.StatusBadRequest)
		return
	}

	jsonData, _ := json.Marshal(export)
	ciphertext, err := encryptWithAge(string(jsonData), req.Passphrase)
	if err != nil {
		http.Error(w, "encryption failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":     true,
		"format": "adomnia-age",
		"data":   ciphertext,
	})
}

// Import workspace encrypted with age passphrase
func vaultImportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Data       string `json:"data"`
		Passphrase string `json:"passphrase"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	plaintext, err := decryptWithAge(req.Data, req.Passphrase)
	if err != nil {
		http.Error(w, "decryption failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	var data map[string]string
	if err := json.Unmarshal([]byte(plaintext), &data); err != nil {
		http.Error(w, "invalid workspace data", http.StatusBadRequest)
		return
	}

	if storeDB == nil {
		http.Error(w, "storage not available", http.StatusInternalServerError)
		return
	}

	imported := 0
	_ = storeDB.Update(func(tx *bolt.Tx) error {
		for key, val := range data {
			parts := strings.SplitN(key, "/", 2)
			if len(parts) != 2 {
				continue
			}
			b := tx.Bucket([]byte(parts[0]))
			if b == nil {
				continue
			}
			if err := b.Put([]byte(parts[1]), []byte(val)); err != nil {
				return err
			}
			imported++
		}
		return nil
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "imported": imported})
}
