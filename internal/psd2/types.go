package psd2

import (
	"crypto"
	"crypto/tls"
	"crypto/x509"
	"time"
)

const (
	HeaderDigest               = "Digest"
	HeaderSignature            = "Signature"
	HeaderSignatureCertificate = "TPP-Signature-Certificate"
	HeaderRequestID            = "X-Request-ID"
	HeaderContentType          = "Content-Type"
	HeaderPSUIP                = "PSU-IP-Address"
	HeaderConsentID            = "Consent-ID"
	DigestPrefix               = "SHA-256="
	SignatureAlgorithm         = "rsa-sha256"
	DefaultSignedHeaders       = "(request-target) digest x-request-id"
	OperationAISConsent        = "ais-consent"
	OperationPISPayment        = "pis-payment"
	OperationFCSConfirmation   = "fcs-confirmation"
)

type CertificateInfo struct {
	Subject                string    `json:"subject"`
	Issuer                 string    `json:"issuer"`
	SerialNumber           string    `json:"serialNumber"`
	OrganizationIdentifier string    `json:"organizationIdentifier"`
	PSPRoles               []string  `json:"pspRoles"`
	NCAName                string    `json:"ncaName"`
	NCAID                  string    `json:"ncaId"`
	NotBefore              time.Time `json:"notBefore"`
	NotAfter               time.Time `json:"notAfter"`
	ValidNow               bool      `json:"validNow"`
	HasPrivateKey          bool      `json:"hasPrivateKey"`
}

type Credential struct {
	Certificate *x509.Certificate
	Signer      crypto.Signer
	TLS         tls.Certificate
}

type CertificateManager interface {
	Inspect(path, password string) (CertificateInfo, error)
	Load(path, password string) (Credential, error)
}

type SignInput struct {
	Method     string
	Target     string
	Body       []byte
	Headers    map[string]string
	Credential Credential
	KeyID      string
}

type SignResult struct {
	Digest               string `json:"digest"`
	Signature            string `json:"signature"`
	SignatureCertificate string `json:"signatureCertificate"`
}

type JWSSigner interface {
	Sign(input SignInput) (SignResult, error)
}

type HeaderBuildInput struct {
	Operation string            `json:"operation"`
	Headers   map[string]string `json:"headers"`
}

type HeaderBuildResult struct {
	Headers     map[string]string `json:"headers"`
	Required    []string          `json:"required"`
	Conditional []string          `json:"conditional"`
	Missing     []string          `json:"missing"`
}

type HeaderBuilder interface {
	Build(input HeaderBuildInput) (HeaderBuildResult, error)
	Validate(input HeaderBuildInput) error
}

type RequestConfig struct {
	Enabled       bool   `json:"enabled"`
	Operation     string `json:"operation"`
	QWACPath      string `json:"qwacPath"`
	QWACPassword  string `json:"qwacPassword,omitempty"`
	QSEALPath     string `json:"qsealPath"`
	QSEALPassword string `json:"qsealPassword,omitempty"`
	KeyID         string `json:"keyId"`
	Sign          bool   `json:"sign"`
}
