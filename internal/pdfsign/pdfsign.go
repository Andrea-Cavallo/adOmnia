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
	"encoding/json/v2"
	"encoding/pem"
	"fmt"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/digitorus/pdf"
	"github.com/digitorus/pdfsign"
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

	document, err := pdfsign.Open(bytes.NewReader(input), int64(len(input)))
	if err != nil {
		return "", fmt.Errorf("read PDF for signing: %w", err)
	}
	if err := stageSignature(document, req, cred); err != nil {
		return "", err
	}

	var out bytes.Buffer
	if _, err := document.Write(&out); err != nil {
		return "", fmt.Errorf("sign PDF: %w", err)
	}

	res := signatureResult{
		PdfBase64: base64.StdEncoding.EncodeToString(out.Bytes()),
		Size:      out.Len(),
	}
	data, _ := jsonutil.Marshal(res)
	return string(data), nil
}

// Default size of a visible signature, in PDF points.
const (
	defaultAppearanceWidth  = 180
	defaultAppearanceHeight = 70
)

// stageSignature adds the approval signature of req to the document: signer
// details, optional visible appearance (the uploaded image, or the standard
// text block), RFC 3161 timestamp and LTV revocation data.
func stageSignature(document *pdfsign.Document, req Request, cred *resolvedCredential) error {
	builder := document.Sign(cred.signer, cred.cert).
		CertificateChains(cred.chain).
		Digest(crypto.SHA256).
		Type(pdfsign.ApprovalSignature).
		SignerName(req.Name).
		Reason(req.Reason).
		Location(req.Location).
		Contact(req.ContactInfo).
		RevocationFunction(noRevocationData)
	if req.Visible {
		appearance, err := signatureAppearance(req)
		if err != nil {
			return err
		}
		page := req.Page
		if page <= 0 {
			page = 1
		}
		builder.Appearance(appearance, req.X, req.Y).Page(page)
	}
	if url := strings.TrimSpace(req.TSAUrl); url != "" {
		builder.Timestamp(url).TimestampAuth(req.TSAUsername, req.TSAPassword)
	}
	if req.EnableLTV {
		builder.RevocationFunction(sign.DefaultEmbedRevocationStatusFunction)
	}
	return nil
}

// noRevocationData embeds nothing: without LTV the signature must not fetch
// OCSP or CRL responses (the library default would, on every signature).
func noRevocationData(_, _ *x509.Certificate, _ *revocation.InfoArchival) error { return nil }

func signatureAppearance(req Request) (*pdfsign.Appearance, error) {
	width, height := req.W, req.H
	if width <= 0 {
		width = defaultAppearanceWidth
	}
	if height <= 0 {
		height = defaultAppearanceHeight
	}
	appearance := pdfsign.NewAppearance(width, height)
	if strings.TrimSpace(req.AppearanceBase64) == "" {
		return appearance.Standard(), nil
	}
	image, err := base64.StdEncoding.DecodeString(req.AppearanceBase64)
	if err != nil {
		return nil, fmt.Errorf("invalid signature appearance image: %w", err)
	}
	appearance.Image(&pdfsign.Image{Name: "signature", Data: image}).Rect(0, 0, width, height).ScaleStretch()
	return appearance, nil
}

// Verify validates the signatures of a base64-encoded PDF and returns the
// verification report as JSON.
func Verify(pdfBase64 string) (string, error) {
	input, err := base64.StdEncoding.DecodeString(pdfBase64)
	if err != nil {
		return "", fmt.Errorf("invalid PDF base64: %w", err)
	}
	resp, err := verifySignatures(input)
	if err != nil {
		return "", fmt.Errorf("verify PDF: %w", err)
	}
	data, _ := jsonutil.Marshal(resp)
	return string(data), nil
}

// verifyOptions are the RFC 9336 defaults of pdfsign (Document Signing EKU,
// Digital Signature key usage, timestamp certificates validated, embedded
// certificates not trusted as roots, no network access).
func verifyOptions() *verify.VerifyOptions {
	return &verify.VerifyOptions{
		RequiredEKUs:                  []x509.ExtKeyUsage{documentSigningEKU},
		AllowedEKUs:                   []x509.ExtKeyUsage{x509.ExtKeyUsageEmailProtection, x509.ExtKeyUsageClientAuth},
		RequireDigitalSignatureKU:     true,
		ValidateTimestampCertificates: true,
		HTTPTimeout:                   10 * time.Second,
	}
}

// documentSigningEKU is id-kp-documentSigning (1.3.6.1.5.5.7.3.36, RFC 9336),
// which crypto/x509 does not name.
const documentSigningEKU = x509.ExtKeyUsage(36)

// verifySignatures reports every signature of the PDF in the verify.Response
// shape the PDF editor reads (Error, Signers with valid_signature,
// trusted_issuer, timestamp fields…).
func verifySignatures(input []byte) (response *verify.Response, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			response, err = nil, fmt.Errorf("malformed PDF (%v)", recovered)
		}
	}()
	reader := bytes.NewReader(input)
	document, err := pdf.NewReader(reader, int64(len(input)))
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	if document.Trailer().Key("Root").Key("AcroForm").Key("SigFlags").IsNull() {
		return nil, fmt.Errorf("no digital signature in document")
	}
	signers, found := verify.VerifySignatures(document, reader, int64(len(input)), verifyOptions())
	if found == 0 || len(signers) == 0 {
		return nil, fmt.Errorf("no readable digital signature in document")
	}
	response = &verify.Response{}
	for _, signer := range signers {
		if len(signer.ValidationErrors) > 0 && response.Error == "" {
			response.Error = signer.ValidationErrors[0].Error()
		}
		response.Signers = append(response.Signers, *signer)
	}
	return response, nil
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
	data, _ := jsonutil.Marshal(info)
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
	if _, encrypted := block.Headers["DEK-Info"]; encrypted { // legacy RFC 1423 encryption
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
