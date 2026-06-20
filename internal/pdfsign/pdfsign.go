// Package pdfsign implements eIDAS-grade PDF digital signatures: signing with a
// PEM or PKCS#12/JKS credential, optional RFC 3161 TSA timestamping and LTV
// revocation embedding, plus signature verification and certificate inspection.
// All operations take and return JSON strings so the Wails bindings stay thin
// and the private key never leaves this Go process.
package pdfsign

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"strings"
	"time"

	"github.com/digitorus/pdf"
	"github.com/digitorus/pdfsign/revocation"
	"github.com/digitorus/pdfsign/sign"
	"github.com/digitorus/pdfsign/verify"
)

// Request is a PDF signing or certificate inspection request.
type Request struct {
	PdfBase64      string `json:"pdfBase64"`
	CertificatePEM string `json:"certificatePem"`
	PrivateKeyPEM  string `json:"privateKeyPem"`

	// Credential source: "pem" (default) or "keystore".
	CredentialSource string `json:"credentialSource"`
	KeystoreBase64   string `json:"keystoreBase64"`
	KeystorePassword string `json:"keystorePassword"`
	KeystoreType     string `json:"keystoreType"` // "p12" | "jks"

	// RFC 3161 timestamp authority (optional). When TSAUrl is set the signature
	// is timestamped; basic auth credentials are optional.
	TSAUrl      string `json:"tsaUrl"`
	TSAUsername string `json:"tsaUsername"`
	TSAPassword string `json:"tsaPassword"`

	// EnableLTV embeds the certificate chain plus OCSP/CRL revocation data into
	// the document DSS for long-term validation.
	EnableLTV bool `json:"enableLtv"`

	Name             string  `json:"name"`
	Location         string  `json:"location"`
	Reason           string  `json:"reason"`
	ContactInfo      string  `json:"contactInfo"`
	Visible          bool    `json:"visible"`
	Page             int     `json:"page"`
	X                float64 `json:"x"`
	Y                float64 `json:"y"`
	W                float64 `json:"w"`
	H                float64 `json:"h"`
	AppearanceBase64 string  `json:"appearanceBase64"`
}

type signatureResult struct {
	PdfBase64 string `json:"pdfBase64"`
	Size      int    `json:"size"`
}

// certificateInfo is metadata about a signing certificate. It never contains
// private key material.
type certificateInfo struct {
	Subject       string `json:"subject"`
	Issuer        string `json:"issuer"`
	SerialNumber  string `json:"serialNumber"`
	NotBefore     string `json:"notBefore"`
	NotAfter      string `json:"notAfter"`
	ChainLength   int    `json:"chainLength"`
	HasPrivateKey bool   `json:"hasPrivateKey"`
}

// Sign signs a PDF document and returns the signed document as JSON.
func Sign(reqJSON string) (string, error) {
	var req Request
	if err := json.Unmarshal([]byte(reqJSON), &req); err != nil {
		return "", fmt.Errorf("invalid signing request: %w", err)
	}
	input, err := base64.StdEncoding.DecodeString(req.PdfBase64)
	if err != nil {
		return "", fmt.Errorf("invalid PDF base64: %w", err)
	}
	cred, err := resolveCredential(req)
	if err != nil {
		return "", err
	}

	reader := bytes.NewReader(input)
	pdfReader, err := pdf.NewReader(reader, int64(len(input)))
	if err != nil {
		return "", fmt.Errorf("read PDF for signing: %w", err)
	}

	var appearanceImage []byte
	if strings.TrimSpace(req.AppearanceBase64) != "" {
		appearanceImage, err = base64.StdEncoding.DecodeString(req.AppearanceBase64)
		if err != nil {
			return "", fmt.Errorf("invalid signature appearance image: %w", err)
		}
	}

	page := req.Page
	if page <= 0 {
		page = 1
	}
	w := req.W
	h := req.H
	if w <= 0 {
		w = 180
	}
	if h <= 0 {
		h = 70
	}

	signData := sign.SignData{
		Signature: sign.SignDataSignature{
			CertType:   sign.ApprovalSignature,
			DocMDPPerm: sign.AllowFillingExistingFormFieldsAndSignaturesPerms,
			Info: sign.SignDataSignatureInfo{
				Name:        req.Name,
				Location:    req.Location,
				Reason:      req.Reason,
				ContactInfo: req.ContactInfo,
				Date:        time.Now().Local(),
			},
		},
		DigestAlgorithm:   crypto.SHA256,
		Signer:            cred.signer,
		Certificate:       cred.cert,
		CertificateChains: cred.chain,
		Appearance: sign.Appearance{
			Visible:     req.Visible,
			Page:        uint32(page),
			LowerLeftX:  req.X,
			LowerLeftY:  req.Y,
			UpperRightX: req.X + w,
			UpperRightY: req.Y + h,
			Image:       appearanceImage,
		},
	}

	if strings.TrimSpace(req.TSAUrl) != "" {
		signData.TSA = sign.TSA{
			URL:      strings.TrimSpace(req.TSAUrl),
			Username: req.TSAUsername,
			Password: req.TSAPassword,
		}
	}

	if req.EnableLTV {
		signData.RevocationData = revocation.InfoArchival{}
		signData.RevocationFunction = sign.DefaultEmbedRevocationStatusFunction
	}

	var out bytes.Buffer
	if err := sign.Sign(reader, &out, pdfReader, int64(len(input)), signData); err != nil {
		return "", fmt.Errorf("sign PDF: %w", err)
	}

	res := signatureResult{
		PdfBase64: base64.StdEncoding.EncodeToString(out.Bytes()),
		Size:      out.Len(),
	}
	data, _ := json.Marshal(res)
	return string(data), nil
}

// Verify validates the signatures of a base64-encoded PDF and returns the
// verification report as JSON.
func Verify(pdfBase64 string) (string, error) {
	input, err := base64.StdEncoding.DecodeString(pdfBase64)
	if err != nil {
		return "", fmt.Errorf("invalid PDF base64: %w", err)
	}
	opts := verify.DefaultVerifyOptions()
	resp, err := verify.VerifyWithOptions(bytes.NewReader(input), int64(len(input)), opts)
	if err != nil {
		return "", fmt.Errorf("verify PDF: %w", err)
	}
	data, _ := json.Marshal(resp)
	return string(data), nil
}

// InspectCertificate resolves the signing credential (PEM or keystore) and
// returns only the certificate metadata, so the UI can show what will be used
// to sign without ever exposing the private key to the frontend.
func InspectCertificate(reqJSON string) (string, error) {
	var req Request
	if err := json.Unmarshal([]byte(reqJSON), &req); err != nil {
		return "", fmt.Errorf("invalid inspect request: %w", err)
	}
	cred, err := resolveCredential(req)
	if err != nil {
		return "", err
	}
	info := certificateInfo{
		Subject:       cred.cert.Subject.String(),
		Issuer:        cred.cert.Issuer.String(),
		SerialNumber:  cred.cert.SerialNumber.String(),
		NotBefore:     cred.cert.NotBefore.UTC().Format(time.RFC3339),
		NotAfter:      cred.cert.NotAfter.UTC().Format(time.RFC3339),
		HasPrivateKey: cred.signer != nil,
	}
	if len(cred.chain) > 0 {
		info.ChainLength = len(cred.chain[0])
	}
	data, _ := json.Marshal(info)
	return string(data), nil
}

func parseCertificatePEM(certPEM string) (*x509.Certificate, error) {
	rest := []byte(certPEM)
	for {
		block, remaining := pem.Decode(rest)
		if block == nil {
			return nil, fmt.Errorf("certificate PEM block not found")
		}
		if block.Type == "CERTIFICATE" {
			cert, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				return nil, fmt.Errorf("parse certificate: %w", err)
			}
			return cert, nil
		}
		rest = remaining
	}
}

func parsePrivateKeyPEM(keyPEM string) (crypto.Signer, error) {
	block, _ := pem.Decode([]byte(keyPEM))
	if block == nil {
		return nil, fmt.Errorf("private key PEM block not found")
	}
	if x509.IsEncryptedPEMBlock(block) {
		return nil, fmt.Errorf("encrypted private keys are not supported here; extract an unencrypted PEM key locally first")
	}

	switch block.Type {
	case "PRIVATE KEY":
		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse PKCS#8 private key: %w", err)
		}
		return cryptoSigner(key)
	case "RSA PRIVATE KEY":
		key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse RSA private key: %w", err)
		}
		return key, nil
	case "EC PRIVATE KEY":
		key, err := x509.ParseECPrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse EC private key: %w", err)
		}
		return key, nil
	default:
		return nil, fmt.Errorf("unsupported private key PEM type %q", block.Type)
	}
}

func cryptoSigner(key any) (crypto.Signer, error) {
	switch k := key.(type) {
	case *rsa.PrivateKey:
		return k, nil
	case *ecdsa.PrivateKey:
		return k, nil
	case ed25519.PrivateKey:
		return k, nil
	case crypto.Signer:
		return k, nil
	default:
		return nil, fmt.Errorf("private key does not implement crypto.Signer")
	}
}
