package psd2

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
)

type RSASigner struct{}

func (RSASigner) Sign(input SignInput) (SignResult, error) {
	if input.Credential.Signer == nil || input.Credential.Certificate == nil {
		return SignResult{}, fmt.Errorf("QSEAL certificate and private key are required")
	}
	if _, ok := input.Credential.Signer.(*rsa.PrivateKey); !ok {
		return SignResult{}, fmt.Errorf("QSEAL private key must be RSA for rsa-sha256")
	}
	if len(input.Body) == 0 {
		return SignResult{}, fmt.Errorf("request body is required when PSD2 signing is enabled")
	}
	if strings.TrimSpace(input.Method) == "" || strings.TrimSpace(input.Target) == "" {
		return SignResult{}, fmt.Errorf("request method and target are required")
	}
	requestID := headerValue(input.Headers, HeaderRequestID)
	if requestID == "" {
		return SignResult{}, fmt.Errorf("%s header is required for signing", HeaderRequestID)
	}
	bodyHash := sha256.Sum256(input.Body)
	digest := DigestPrefix + base64.StdEncoding.EncodeToString(bodyHash[:])
	signingString := fmt.Sprintf("(request-target): %s %s\ndigest: %s\nx-request-id: %s", strings.ToLower(input.Method), input.Target, digest, requestID)
	sum := sha256.Sum256([]byte(signingString))
	signature, err := input.Credential.Signer.Sign(rand.Reader, sum[:], crypto.SHA256)
	if err != nil {
		return SignResult{}, fmt.Errorf("sign PSD2 request: %w", err)
	}
	keyID := strings.TrimSpace(input.KeyID)
	if keyID == "" {
		keyID = input.Credential.Certificate.SerialNumber.String()
	}
	value := fmt.Sprintf(`keyId="%s",algorithm="%s",headers="%s",signature="%s"`, keyID, SignatureAlgorithm, DefaultSignedHeaders, base64.StdEncoding.EncodeToString(signature))
	return SignResult{Digest: digest, Signature: value, SignatureCertificate: base64.StdEncoding.EncodeToString(input.Credential.Certificate.Raw)}, nil
}

func headerValue(headers map[string]string, name string) string {
	for key, value := range headers {
		if strings.EqualFold(key, name) {
			return value
		}
	}
	return ""
}
