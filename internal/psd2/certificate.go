package psd2

import (
	"crypto"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

var (
	oidOrganizationIdentifier = asn1.ObjectIdentifier{2, 5, 4, 97}
	oidQCStatements           = asn1.ObjectIdentifier{1, 3, 6, 1, 5, 5, 7, 1, 3}
	oidPSD2QCStatement        = asn1.ObjectIdentifier{0, 4, 0, 19495, 2}
	pspRoleNames              = map[string]string{
		"0.4.0.19495.1.1": "PSP_AS",
		"0.4.0.19495.1.2": "PSP_PI",
		"0.4.0.19495.1.3": "PSP_AI",
		"0.4.0.19495.1.4": "PSP_IC",
	}
)

type FileCertificateManager struct{}

func (FileCertificateManager) Inspect(path, password string) (CertificateInfo, error) {
	credential, err := (FileCertificateManager{}).Load(path, password)
	if err == nil {
		return certificateInfo(credential), nil
	}
	if strings.ToLower(filepath.Ext(path)) == ".p12" || strings.ToLower(filepath.Ext(path)) == ".pfx" {
		return CertificateInfo{}, err
	}
	raw, readErr := os.ReadFile(filepath.Clean(path))
	if readErr != nil {
		return CertificateInfo{}, fmt.Errorf("read certificate file: %w", readErr)
	}
	cert, parseErr := parseFirstPEMCertificate(raw)
	if parseErr != nil {
		return CertificateInfo{}, err
	}
	return certificateInfo(Credential{Certificate: cert}), nil
}

func (FileCertificateManager) Load(path, password string) (Credential, error) {
	if strings.TrimSpace(path) == "" {
		return Credential{}, fmt.Errorf("certificate path is required")
	}
	raw, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return Credential{}, fmt.Errorf("read certificate file: %w", err)
	}
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".p12" || ext == ".pfx" {
		return loadPKCS12(raw, password)
	}
	return loadPEM(raw, password)
}

func loadPKCS12(raw []byte, password string) (Credential, error) {
	key, cert, chain, err := pkcs12.DecodeChain(raw, password)
	if err != nil {
		return Credential{}, fmt.Errorf("decode PKCS#12 (check password): %w", err)
	}
	signer, ok := key.(crypto.Signer)
	if !ok {
		return Credential{}, fmt.Errorf("PKCS#12 private key cannot sign")
	}
	certificates := [][]byte{cert.Raw}
	for _, item := range chain {
		certificates = append(certificates, item.Raw)
	}
	return validatedCredential(cert, signer, certificates)
}

func loadPEM(raw []byte, password string) (Credential, error) {
	var certs []*x509.Certificate
	var signer crypto.Signer
	for rest := raw; len(rest) > 0; {
		block, next := pem.Decode(rest)
		if block == nil {
			break
		}
		rest = next
		if block.Type == "CERTIFICATE" {
			cert, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				return Credential{}, fmt.Errorf("parse PEM certificate: %w", err)
			}
			certs = append(certs, cert)
			continue
		}
		if strings.Contains(block.Type, "PRIVATE KEY") {
			keyBytes := block.Bytes
			if x509.IsEncryptedPEMBlock(block) {
				if password == "" {
					return Credential{}, fmt.Errorf("private key password is required")
				}
				decoded, err := x509.DecryptPEMBlock(block, []byte(password))
				if err != nil {
					return Credential{}, fmt.Errorf("decrypt private key: %w", err)
				}
				keyBytes = decoded
			}
			parsed, err := parsePrivateKey(keyBytes)
			if err != nil {
				return Credential{}, err
			}
			signer = parsed
		}
	}
	if len(certs) == 0 {
		return Credential{}, fmt.Errorf("PEM certificate not found")
	}
	if signer == nil {
		return Credential{}, fmt.Errorf("PEM private key not found")
	}
	chain := make([][]byte, 0, len(certs))
	for _, cert := range certs {
		chain = append(chain, cert.Raw)
	}
	return validatedCredential(certs[0], signer, chain)
}

func parseFirstPEMCertificate(raw []byte) (*x509.Certificate, error) {
	for rest := raw; len(rest) > 0; {
		block, next := pem.Decode(rest)
		if block == nil {
			break
		}
		rest = next
		if block.Type != "CERTIFICATE" {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse PEM certificate: %w", err)
		}
		return cert, nil
	}
	return nil, fmt.Errorf("PEM certificate not found")
}

func parsePrivateKey(raw []byte) (crypto.Signer, error) {
	if key, err := x509.ParsePKCS8PrivateKey(raw); err == nil {
		if signer, ok := key.(crypto.Signer); ok {
			return signer, nil
		}
	}
	if key, err := x509.ParsePKCS1PrivateKey(raw); err == nil {
		return key, nil
	}
	return nil, fmt.Errorf("unsupported private key format")
}

func validatedCredential(cert *x509.Certificate, signer crypto.Signer, chain [][]byte) (Credential, error) {
	if !publicKeysEqual(cert.PublicKey, signer.Public()) {
		return Credential{}, fmt.Errorf("certificate and private key do not match")
	}
	return Credential{Certificate: cert, Signer: signer, TLS: tls.Certificate{Certificate: chain, PrivateKey: signer, Leaf: cert}}, nil
}

func publicKeysEqual(a, b any) bool {
	aRaw, aErr := x509.MarshalPKIXPublicKey(a)
	bRaw, bErr := x509.MarshalPKIXPublicKey(b)
	return aErr == nil && bErr == nil && string(aRaw) == string(bRaw)
}

func certificateInfo(credential Credential) CertificateInfo {
	cert := credential.Certificate
	roles, ncaName, ncaID := parsePSD2Statements(cert)
	return CertificateInfo{
		Subject: cert.Subject.String(), Issuer: cert.Issuer.String(), SerialNumber: cert.SerialNumber.String(),
		OrganizationIdentifier: subjectValue(cert.Subject.Names, oidOrganizationIdentifier), PSPRoles: roles,
		NCAName: ncaName, NCAID: ncaID, NotBefore: cert.NotBefore, NotAfter: cert.NotAfter,
		ValidNow: !time.Now().Before(cert.NotBefore) && !time.Now().After(cert.NotAfter), HasPrivateKey: credential.Signer != nil,
	}
}

func subjectValue(names []pkix.AttributeTypeAndValue, oid asn1.ObjectIdentifier) string {
	for _, name := range names {
		if name.Type.Equal(oid) {
			return fmt.Sprint(name.Value)
		}
	}
	return ""
}

type qcStatement struct {
	ID   asn1.ObjectIdentifier
	Info asn1.RawValue `asn1:"optional"`
}
type roleOfPSP struct {
	OID  asn1.ObjectIdentifier
	Name string
}
type psd2QCType struct {
	Roles   []roleOfPSP
	NCAName string
	NCAID   string
}

func parsePSD2Statements(cert *x509.Certificate) ([]string, string, string) {
	for _, ext := range cert.Extensions {
		if !ext.Id.Equal(oidQCStatements) {
			continue
		}
		var statements []qcStatement
		if _, err := asn1.Unmarshal(ext.Value, &statements); err != nil {
			return nil, "", ""
		}
		for _, statement := range statements {
			if !statement.ID.Equal(oidPSD2QCStatement) {
				continue
			}
			var value psd2QCType
			if _, err := asn1.Unmarshal(statement.Info.FullBytes, &value); err != nil {
				return nil, "", ""
			}
			roles := make([]string, 0, len(value.Roles))
			for _, role := range value.Roles {
				if name := pspRoleNames[role.OID.String()]; name != "" {
					roles = append(roles, name)
				}
			}
			return roles, value.NCAName, value.NCAID
		}
	}
	return []string{}, "", ""
}
