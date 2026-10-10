// update-manifest signs bounded platform ZIPs, or creates a publisher key pair.
package main

import (
	"adomnia/internal/update"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	keydir := flag.String("keygen", "", "private directory for a new publisher key")
	dir := flag.String("dir", "dist", "artifact directory")
	version := flag.String("version", "", "release tag")
	flag.Parse()
	if *keydir != "" {
		if err := os.MkdirAll(*keydir, 0700); err != nil {
			return err
		}
		pub, key, e := ed25519.GenerateKey(rand.Reader)
		if e != nil {
			return e
		}
		f, e := os.OpenFile(filepath.Join(*keydir, "update-signing-key.txt"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return e
		}
		_, e = f.WriteString(base64.StdEncoding.EncodeToString(key))
		f.Close()
		if e != nil {
			return e
		}
		return os.WriteFile(filepath.Join(*keydir, "update-public-key.txt"), []byte(base64.StdEncoding.EncodeToString(pub)), 0600)
	}
	key, e := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("ADOMNIA_UPDATE_SIGNING_KEY")))
	if e != nil || len(key) != ed25519.PrivateKeySize {
		return fmt.Errorf("ADOMNIA_UPDATE_SIGNING_KEY must be an Ed25519 private key")
	}
	manifest := update.Manifest{Version: *version}
	files, e := filepath.Glob(filepath.Join(*dir, "*-update.zip"))
	if e != nil {
		return e
	}
	for _, name := range files {
		base := filepath.Base(name)
		platform, arch := "", ""
		switch {
		case strings.Contains(base, "-windows-amd64-"):
			platform = "windows"
			arch = "amd64"
		case strings.Contains(base, "-linux-amd64-"):
			platform = "linux"
			arch = "amd64"
		case strings.Contains(base, "-macos-universal-"):
			platform = "darwin"
			arch = "universal"
		default:
			return fmt.Errorf("unknown update platform: %s", base)
		}
		f, e := os.Open(name)
		if e != nil {
			return e
		}
		h := sha256.New()
		n, e := io.Copy(h, f)
		f.Close()
		if e != nil {
			return e
		}
		manifest.Assets = append(manifest.Assets, update.Asset{Name: base, URL: "https://github.com/Andrea-Cavallo/adOmnia/releases/download/" + *version + "/" + base, SHA256: hex.EncodeToString(h.Sum(nil)), Size: n, OS: platform, Arch: arch})
	}
	if len(manifest.Assets) != 3 {
		return fmt.Errorf("need all three platform update packages before signing")
	}
	payload, e := json.Marshal(manifest)
	if e != nil {
		return e
	}
	envelope := update.Envelope{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}
	raw, _ := json.MarshalIndent(envelope, "", "  ")
	if _, err := update.VerifyEnvelope(raw, update.PublicKey); err != nil {
		return fmt.Errorf("signing key does not match the app publisher identity")
	}
	return os.WriteFile(filepath.Join(*dir, "update-manifest.json"), raw, 0644)
}
