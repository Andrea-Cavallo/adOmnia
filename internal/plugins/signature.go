package plugins

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"adomnia/internal/storage"

	bolt "go.etcd.io/bbolt"
)

// Signed plugins: signature.json at the plugin root holds an ed25519 signature over a digest of every
// other file (path + SHA-256 of its content, sorted). Any change to any file invalidates it.
// A valid signature from a key the user trusts marks the plugin "trusted"; an invalid signature blocks
// enabling the plugin. Unsigned plugins keep working as local, user-installed code.

const signatureFile = "signature.json"

// PluginSignatureFile is the content of signature.json.
type PluginSignatureFile struct {
	Algorithm string `json:"algorithm"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
}

// PluginSignature is the verification outcome shown in the Plugin Manager.
type PluginSignature struct {
	// Status is unsigned, valid or invalid.
	Status  string `json:"status"`
	KeyID   string `json:"keyId,omitempty"`
	Trusted bool   `json:"trusted"`
	Detail  string `json:"detail,omitempty"`
}

// PluginSigningKey is a freshly generated key pair, base64-encoded. The private key is shown once
// to the developer and never stored by adOmnia.
type PluginSigningKey struct {
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
	KeyID      string `json:"keyId"`
}

func keyID(publicKey []byte) string {
	sum := sha256.Sum256(publicKey)
	return hex.EncodeToString(sum[:8])
}

// pluginDigest hashes every regular file under dir except signature.json.
func pluginDigest(dir string) ([]byte, error) {
	var lines []string
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("non-regular file in plugin: %s", entry.Name())
		}
		relative, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if relative == signatureFile {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		lines = append(lines, relative+"\x00"+hex.EncodeToString(sum[:]))
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return sum[:], nil
}

// verifyPluginDirectory checks signature.json against the files and the trusted keys.
func verifyPluginDirectory(dir string, trusted map[string]bool) PluginSignature {
	raw, err := os.ReadFile(filepath.Join(dir, signatureFile))
	if os.IsNotExist(err) {
		return PluginSignature{Status: "unsigned"}
	}
	if err != nil {
		return PluginSignature{Status: "invalid", Detail: err.Error()}
	}
	var file PluginSignatureFile
	if err := json.Unmarshal(raw, &file); err != nil || file.Algorithm != "ed25519" {
		return PluginSignature{Status: "invalid", Detail: "signature.json is not an ed25519 signature"}
	}
	publicKey, errKey := base64.StdEncoding.DecodeString(file.PublicKey)
	signature, errSig := base64.StdEncoding.DecodeString(file.Signature)
	if errKey != nil || errSig != nil || len(publicKey) != ed25519.PublicKeySize {
		return PluginSignature{Status: "invalid", Detail: "malformed key or signature"}
	}
	digest, err := pluginDigest(dir)
	if err != nil {
		return PluginSignature{Status: "invalid", Detail: err.Error()}
	}
	id := keyID(publicKey)
	if !ed25519.Verify(publicKey, digest, signature) {
		return PluginSignature{Status: "invalid", KeyID: id, Detail: "files were changed after signing"}
	}
	return PluginSignature{Status: "valid", KeyID: id, Trusted: trusted[file.PublicKey]}
}

// GeneratePluginSigningKey creates an ed25519 key pair for signing plugins (developer mode).
func (pm *PluginManager) GeneratePluginSigningKey() (PluginSigningKey, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return PluginSigningKey{}, err
	}
	return PluginSigningKey{
		PublicKey:  base64.StdEncoding.EncodeToString(publicKey),
		PrivateKey: base64.StdEncoding.EncodeToString(privateKey),
		KeyID:      keyID(publicKey),
	}, nil
}

// SignPluginDirectory writes signature.json into a plugin source directory with the given private key.
func (pm *PluginManager) SignPluginDirectory(sourceDir, privateKey string) (PluginSignature, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(privateKey))
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return PluginSignature{}, fmt.Errorf("the private key must be a base64 ed25519 key")
	}
	if _, err := os.Stat(filepath.Join(sourceDir, "manifest.json")); err != nil {
		return PluginSignature{}, fmt.Errorf("the folder has no manifest.json")
	}
	digest, err := pluginDigest(sourceDir)
	if err != nil {
		return PluginSignature{}, err
	}
	private := ed25519.PrivateKey(key)
	public := private.Public().(ed25519.PublicKey)
	file := PluginSignatureFile{Algorithm: "ed25519", PublicKey: base64.StdEncoding.EncodeToString(public), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(private, digest))}
	data, _ := json.MarshalIndent(file, "", "  ")
	if err := os.WriteFile(filepath.Join(sourceDir, signatureFile), data, 0o644); err != nil {
		return PluginSignature{}, err
	}
	return verifyPluginDirectory(sourceDir, pm.trustedKeySet()), nil
}

// GetTrustedPluginKeys returns the public keys whose signatures mark a plugin as trusted.
func (pm *PluginManager) GetTrustedPluginKeys() []string {
	keys := loadTrustedKeys()
	sort.Strings(keys)
	return keys
}

// TrustPluginKey adds a public key to the trusted list and re-verifies installed plugins.
func (pm *PluginManager) TrustPluginKey(publicKey string) error {
	publicKey = strings.TrimSpace(publicKey)
	if raw, err := base64.StdEncoding.DecodeString(publicKey); err != nil || len(raw) != ed25519.PublicKeySize {
		return fmt.Errorf("not a base64 ed25519 public key")
	}
	keys := loadTrustedKeys()
	for _, key := range keys {
		if key == publicKey {
			return nil
		}
	}
	if err := saveTrustedKeys(append(keys, publicKey)); err != nil {
		return err
	}
	pm.refreshSignatures()
	return nil
}

// UntrustPluginKey removes a public key from the trusted list.
func (pm *PluginManager) UntrustPluginKey(publicKey string) error {
	var kept []string
	for _, key := range loadTrustedKeys() {
		if key != strings.TrimSpace(publicKey) {
			kept = append(kept, key)
		}
	}
	if err := saveTrustedKeys(kept); err != nil {
		return err
	}
	pm.refreshSignatures()
	return nil
}

func (pm *PluginManager) trustedKeySet() map[string]bool {
	set := map[string]bool{}
	for _, key := range loadTrustedKeys() {
		set[key] = true
	}
	return set
}

// refreshSignatures re-verifies every installed plugin (after install, reload or trust changes).
func (pm *PluginManager) refreshSignatures() {
	trusted := pm.trustedKeySet()
	pm.mu.Lock()
	defer pm.mu.Unlock()
	for _, inst := range pm.plugins {
		pm.applySignatureLocked(inst, trusted)
	}
}

func (pm *PluginManager) applySignatureLocked(inst *PluginInstance, trusted map[string]bool) {
	if inst.InstallDir == "" {
		return
	}
	signature := verifyPluginDirectory(inst.InstallDir, trusted)
	inst.Signature = &signature
	if signature.Status == "invalid" {
		if inst.Enabled {
			inst.Enabled = false
			pm.unregisterHooksInternal(inst.Manifest.ID)
		}
		inst.Error = "invalid signature: " + signature.Detail
	} else if strings.HasPrefix(inst.Error, "invalid signature: ") {
		inst.Error = ""
	}
}

const trustedKeysEntry = "trusted_keys"

func loadTrustedKeys() []string {
	if storage.DB() == nil {
		return nil
	}
	var keys []string
	_ = storage.DB().View(func(tx *bolt.Tx) error {
		if bucket := tx.Bucket([]byte("plugins")); bucket != nil {
			if raw := bucket.Get([]byte(trustedKeysEntry)); raw != nil {
				_ = json.Unmarshal(raw, &keys)
			}
		}
		return nil
	})
	return keys
}

func saveTrustedKeys(keys []string) error {
	if storage.DB() == nil {
		return fmt.Errorf("storage not available")
	}
	data, _ := json.Marshal(keys)
	return storage.DB().Update(func(tx *bolt.Tx) error {
		bucket, err := tx.CreateBucketIfNotExists([]byte("plugins"))
		if err != nil {
			return err
		}
		return bucket.Put([]byte(trustedKeysEntry), data)
	})
}
