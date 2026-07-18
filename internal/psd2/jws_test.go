package psd2

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"math/big"
	"strings"
	"testing"
	"time"
)

func testCredential(t *testing.T) Credential {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(42), Subject: pkix.Name{CommonName: "QSEAL test"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature}
	raw, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(raw)
	if err != nil {
		t.Fatal(err)
	}
	return Credential{Certificate: cert, Signer: key}
}

func TestRSASignerKnownDigestAndVerifiableSignature(t *testing.T) {
	credential := testCredential(t)
	result, err := (RSASigner{}).Sign(SignInput{Method: "POST", Target: "/v1/consents", Body: []byte("{\"access\":{}}"), Headers: map[string]string{HeaderRequestID: "00000000-0000-4000-8000-000000000001"}, Credential: credential})
	if err != nil {
		t.Fatal(err)
	}
	const expectedDigest = "SHA-256=EDM9U+CZ8qMVhxlGa2wcg6zB3aKzv13I6f0akzJCf18="
	if result.Digest != expectedDigest {
		t.Fatalf("digest mismatch: %s", result.Digest)
	}
	if !strings.Contains(result.Signature, `algorithm="rsa-sha256"`) {
		t.Fatalf("signature metadata missing: %s", result.Signature)
	}
	if result.SignatureCertificate != base64.StdEncoding.EncodeToString(credential.Certificate.Raw) {
		t.Fatal("certificate header mismatch")
	}
	signatureB64 := strings.TrimSuffix(strings.Split(result.Signature, `signature="`)[1], `"`)
	signature, err := base64.StdEncoding.DecodeString(signatureB64)
	if err != nil {
		t.Fatal(err)
	}
	signingString := "(request-target): post /v1/consents\ndigest: " + expectedDigest + "\nx-request-id: 00000000-0000-4000-8000-000000000001"
	hash := sha256.Sum256([]byte(signingString))
	if err := rsa.VerifyPKCS1v15(credential.Certificate.PublicKey.(*rsa.PublicKey), crypto.SHA256, hash[:], signature); err != nil {
		t.Fatalf("signature verification failed: %v", err)
	}
}

func TestRSASignerRejectsEmptyBody(t *testing.T) {
	_, err := (RSASigner{}).Sign(SignInput{Method: "POST", Target: "/", Headers: map[string]string{HeaderRequestID: "x"}, Credential: testCredential(t)})
	if err == nil || !strings.Contains(err.Error(), "body") {
		t.Fatalf("expected explicit body error, got %v", err)
	}
}
