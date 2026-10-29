package nettools

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"strings"
	"testing"
	"time"
)

func pemFixture(t *testing.T) (certificate, rsaKey, ed25519Key string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(42),
		Subject:      pkix.Name{CommonName: "api.example.test", Organization: []string{"adOmnia"}},
		DNSNames:     []string{"api.example.test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(30 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	_, edKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	edDER, err := x509.MarshalPKCS8PrivateKey(edKey)
	if err != nil {
		t.Fatal(err)
	}
	certificate = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	rsaKey = string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
	ed25519Key = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: edDER}))
	return certificate, rsaKey, ed25519Key
}

func TestInspectPEMDescribesCertificatesAndKeys(t *testing.T) {
	certificate, rsaKey, edKey := pemFixture(t)
	encrypted, _, err := transformPrivateKeys(rsaKey, "correct horse", true)
	if err != nil {
		t.Fatal(err)
	}
	csr := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: []byte{1, 2, 3}}))

	results, err := InspectPEM(certificate + rsaKey + encrypted + edKey + csr)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 5 {
		t.Fatalf("results = %d, want 5", len(results))
	}
	cert := results[0]
	if cert.Subject.CN != "api.example.test" || cert.KeyBits != 2048 || cert.IsExpired || cert.DaysRemaining < 29 || len(cert.SANs) != 1 {
		t.Errorf("certificate = %+v", cert)
	}
	if key := results[1]; key.BlockType != "RSA PRIVATE KEY" || key.PublicKeyAlgorithm != "RSA" || key.KeyBits != 2048 || key.Encrypted || key.Error != "" {
		t.Errorf("rsa key = %+v", key)
	}
	if key := results[2]; key.BlockType != "ENCRYPTED PRIVATE KEY" || !key.Encrypted || key.Error != "" {
		t.Errorf("encrypted key = %+v", key)
	}
	if key := results[3]; key.PublicKeyAlgorithm != "Ed25519" || key.KeyBits != 256 {
		t.Errorf("ed25519 key = %+v", key)
	}
	if other := results[4]; other.Error == "" {
		t.Errorf("a CSR must be reported as not inspectable: %+v", other)
	}
}

// Il riepilogo di una chiave privata non deve mai contenere il suo materiale.
func TestInspectPEMNeverReturnsKeyMaterial(t *testing.T) {
	_, rsaKey, _ := pemFixture(t)
	block, _ := pem.Decode([]byte(rsaKey))
	results, err := InspectPEM(rsaKey)
	if err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(results)
	if err != nil {
		t.Fatal(err)
	}
	material := base64.StdEncoding.EncodeToString(block.Bytes)
	if strings.Contains(string(out), material[:40]) || strings.Contains(string(out), "BEGIN") {
		t.Fatalf("key material leaked: %s", out)
	}
}

func TestInspectPEMRejectsEmptyAndHugeInput(t *testing.T) {
	if _, err := InspectPEM("not a pem"); err == nil {
		t.Error("text without PEM blocks must fail")
	}
	if _, err := InspectPEM(strings.Repeat("x", maxPEMInputBytes+1)); err == nil {
		t.Error("input over 1 MB must fail")
	}
}
