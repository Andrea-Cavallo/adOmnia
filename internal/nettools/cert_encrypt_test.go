package nettools

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const testCertificate = "-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n"

func TestPrivateKeyEncryptionRoundTrip(t *testing.T) {
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(ecKey)
	ecDER, _ := x509.MarshalECPrivateKey(ecKey)
	inputs := map[string]string{
		"PKCS#1 + cert": string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(rsaKey)})) + testCertificate,
		"PKCS#8":        string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER})),
		"SEC1":          string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: ecDER})),
	}
	for name, input := range inputs {
		encrypted, keys, err := transformPrivateKeys(input, "correct horse", true)
		if err != nil || keys != 1 {
			t.Fatalf("%s: encrypt keys=%d err=%v", name, keys, err)
		}
		if !strings.Contains(encrypted, "BEGIN ENCRYPTED PRIVATE KEY") || strings.Contains(encrypted, "BEGIN RSA PRIVATE KEY") {
			t.Fatalf("%s: output not encrypted:\n%s", name, encrypted)
		}
		if strings.Contains(input, "CERTIFICATE") != strings.Contains(encrypted, "BEGIN CERTIFICATE") {
			t.Fatalf("%s: certificate block must be kept untouched", name)
		}
		if _, _, err := transformPrivateKeys(encrypted, "wrong password", false); err == nil {
			t.Fatalf("%s: wrong password accepted", name)
		}
		decrypted, _, err := transformPrivateKeys(encrypted, "correct horse", false)
		if err != nil {
			t.Fatalf("%s: decrypt: %v", name, err)
		}
		block, _ := pem.Decode([]byte(decrypted))
		if _, err := x509.ParsePKCS8PrivateKey(block.Bytes); err != nil {
			t.Fatalf("%s: decrypted key unreadable: %v", name, err)
		}
	}
}

func TestPrivateKeyEncryptionRejectsBadInput(t *testing.T) {
	if _, _, err := transformPrivateKeys(testCertificate, "long enough", true); err == nil {
		t.Fatal("a certificate alone must not be reported as encrypted")
	}
	if _, _, err := transformPrivateKeys("not pem", "long enough", true); err == nil {
		t.Fatal("non-PEM input accepted")
	}
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	if _, _, err := transformPrivateKeys(string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), "short", true); err == nil {
		t.Fatal("short password accepted")
	}
}

// OpenSSL deve aprire la chiave cifrata da adOmnia: è lo scopo del formato standard.
func TestEncryptedKeyOpensWithOpenSSL(t *testing.T) {
	openssl, err := exec.LookPath("openssl")
	if err != nil {
		t.Skip("openssl non installato")
	}
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	encrypted, _, err := transformPrivateKeys(string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})), "correct horse", true)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "key.pem")
	if err := os.WriteFile(path, []byte(encrypted), 0o600); err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command(openssl, "pkey", "-in", path, "-passin", "pass:correct horse", "-noout").CombinedOutput()
	if err != nil {
		t.Fatalf("openssl non apre la chiave: %v\n%s", err, output)
	}
}
