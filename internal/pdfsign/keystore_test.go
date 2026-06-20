package pdfsign

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

func testKeyAndCert(t *testing.T) (*rsa.PrivateKey, *x509.Certificate, []byte) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(42),
		Subject:      pkix.Name{CommonName: "adOmnia Test Signer"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse cert: %v", err)
	}
	return key, cert, der
}

func TestResolvePEMCredential(t *testing.T) {
	key, cert, der := testKeyAndCert(t)
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})

	cred, err := resolveCredential(Request{
		CredentialSource: "pem",
		CertificatePEM:   string(certPEM),
		PrivateKeyPEM:    string(keyPEM),
	})
	if err != nil {
		t.Fatalf("resolveCredential pem: %v", err)
	}
	if cred.signer == nil || cred.cert == nil {
		t.Fatal("expected signer and cert")
	}
	if cred.cert.Subject.CommonName != cert.Subject.CommonName {
		t.Fatalf("unexpected subject %q", cred.cert.Subject.CommonName)
	}
	if len(cred.chain) != 1 || len(cred.chain[0]) != 1 {
		t.Fatalf("unexpected chain shape %v", cred.chain)
	}
}

func TestResolvePKCS12Credential(t *testing.T) {
	key, cert, _ := testKeyAndCert(t)
	const pass = "changeit"
	pfx, err := pkcs12.Modern.Encode(key, cert, nil, pass)
	if err != nil {
		t.Fatalf("encode p12: %v", err)
	}
	b64 := base64.StdEncoding.EncodeToString(pfx)

	cred, err := resolveCredential(Request{
		CredentialSource: "keystore",
		KeystoreType:     "p12",
		KeystoreBase64:   b64,
		KeystorePassword: pass,
	})
	if err != nil {
		t.Fatalf("resolveCredential p12: %v", err)
	}
	if cred.signer == nil || cred.cert == nil {
		t.Fatal("expected signer and cert from p12")
	}
	if cred.cert.SerialNumber.Cmp(cert.SerialNumber) != 0 {
		t.Fatal("p12 serial mismatch")
	}

	if _, err := resolveCredential(Request{
		CredentialSource: "keystore", KeystoreType: "p12", KeystoreBase64: b64, KeystorePassword: "wrong",
	}); err == nil {
		t.Fatal("expected error for wrong p12 password")
	}
}

func TestResolveJKSCredential(t *testing.T) {
	key, _, der := testKeyAndCert(t)
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	const pass = "changeit"
	ks := keystore.New()
	if err := ks.SetPrivateKeyEntry("signer", keystore.PrivateKeyEntry{
		CreationTime:     time.Now(),
		PrivateKey:       keyDER,
		CertificateChain: []keystore.Certificate{{Type: "X.509", Content: der}},
	}, []byte(pass)); err != nil {
		t.Fatalf("set jks entry: %v", err)
	}
	var buf bytes.Buffer
	if err := ks.Store(&buf, []byte(pass)); err != nil {
		t.Fatalf("store jks: %v", err)
	}
	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())

	cred, err := resolveCredential(Request{
		CredentialSource: "keystore",
		KeystoreType:     "jks",
		KeystoreBase64:   b64,
		KeystorePassword: pass,
	})
	if err != nil {
		t.Fatalf("resolveCredential jks: %v", err)
	}
	if cred.signer == nil || cred.cert == nil {
		t.Fatal("expected signer and cert from jks")
	}
	if len(cred.chain) != 1 || len(cred.chain[0]) != 1 {
		t.Fatalf("unexpected jks chain shape %v", cred.chain)
	}

	if _, err := resolveCredential(Request{
		CredentialSource: "keystore", KeystoreType: "jks", KeystoreBase64: b64, KeystorePassword: "wrong",
	}); err == nil {
		t.Fatal("expected error for wrong jks password")
	}
}

func TestResolveCredentialUnsupported(t *testing.T) {
	if _, err := resolveCredential(Request{CredentialSource: "smartcard"}); err == nil {
		t.Fatal("expected error for unsupported credential source")
	}
	if _, err := resolveCredential(Request{
		CredentialSource: "keystore", KeystoreType: "unknown", KeystoreBase64: base64.StdEncoding.EncodeToString([]byte("x")),
	}); err == nil {
		t.Fatal("expected error for unsupported keystore type")
	}
}
