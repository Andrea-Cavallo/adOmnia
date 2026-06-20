package pdfsign

import (
	"bytes"
	"crypto"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"strings"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

func decodeKeystoreBytes(b64 string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		return nil, fmt.Errorf("invalid keystore base64: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("keystore is empty")
	}
	return raw, nil
}

// resolvedCredential is the signing material extracted from either raw PEM or a
// PKCS#12 / JKS keystore. The private key never leaves the Go process: it is
// extracted in memory here and consumed directly by the signer.
type resolvedCredential struct {
	signer crypto.Signer
	cert   *x509.Certificate
	// chain is [leaf, intermediate...]. pdfsign uses chain[0][1:] as the CA
	// chain and needs the issuer for revocation (LTV) lookups.
	chain [][]*x509.Certificate
}

// resolveCredential builds the signing material from a signing request,
// honouring its credentialSource ("pem" or "keystore"). PEM is the default for
// backward compatibility.
func resolveCredential(req Request) (*resolvedCredential, error) {
	switch strings.ToLower(strings.TrimSpace(req.CredentialSource)) {
	case "", "pem":
		return resolvePEMCredential(req.CertificatePEM, req.PrivateKeyPEM)
	case "keystore":
		return resolveKeystoreCredential(req)
	default:
		return nil, fmt.Errorf("unsupported credential source %q", req.CredentialSource)
	}
}

func resolvePEMCredential(certPEM, keyPEM string) (*resolvedCredential, error) {
	cert, err := parseCertificatePEM(certPEM)
	if err != nil {
		return nil, err
	}
	signer, err := parsePrivateKeyPEM(keyPEM)
	if err != nil {
		return nil, err
	}
	return &resolvedCredential{
		signer: signer,
		cert:   cert,
		chain:  [][]*x509.Certificate{{cert}},
	}, nil
}

func resolveKeystoreCredential(req Request) (*resolvedCredential, error) {
	raw, err := decodeKeystoreBytes(req.KeystoreBase64)
	if err != nil {
		return nil, err
	}
	switch strings.ToLower(strings.TrimSpace(req.KeystoreType)) {
	case "p12", "pfx", "pkcs12":
		return loadFromPKCS12(raw, req.KeystorePassword)
	case "jks":
		return loadFromJKS(raw, req.KeystorePassword)
	case "":
		return nil, fmt.Errorf("keystore type is required (p12 or jks)")
	default:
		return nil, fmt.Errorf("unsupported keystore type %q", req.KeystoreType)
	}
}

func loadFromPKCS12(raw []byte, password string) (*resolvedCredential, error) {
	key, cert, caCerts, err := pkcs12.DecodeChain(raw, password)
	if err != nil {
		return nil, fmt.Errorf("read PKCS#12 keystore (check password): %w", err)
	}
	if cert == nil {
		return nil, fmt.Errorf("PKCS#12 keystore has no leaf certificate")
	}
	signer, err := cryptoSigner(key)
	if err != nil {
		return nil, err
	}
	leafChain := append([]*x509.Certificate{cert}, caCerts...)
	return &resolvedCredential{signer: signer, cert: cert, chain: [][]*x509.Certificate{leafChain}}, nil
}

func loadFromJKS(raw []byte, password string) (*resolvedCredential, error) {
	ks := keystore.New()
	if err := ks.Load(bytes.NewReader(raw), []byte(password)); err != nil {
		return nil, fmt.Errorf("read JKS keystore (check password): %w", err)
	}
	for _, alias := range ks.Aliases() {
		if !ks.IsPrivateKeyEntry(alias) {
			continue
		}
		entry, err := ks.GetPrivateKeyEntry(alias, []byte(password))
		if err != nil {
			return nil, fmt.Errorf("read JKS private key entry %q (check password): %w", alias, err)
		}
		key, err := x509.ParsePKCS8PrivateKey(entry.PrivateKey)
		if err != nil {
			return nil, fmt.Errorf("parse JKS private key for %q: %w", alias, err)
		}
		signer, err := cryptoSigner(key)
		if err != nil {
			return nil, err
		}
		leafChain, err := parseJKSChain(entry.CertificateChain)
		if err != nil {
			return nil, err
		}
		if len(leafChain) == 0 {
			return nil, fmt.Errorf("JKS entry %q has no certificate chain", alias)
		}
		return &resolvedCredential{signer: signer, cert: leafChain[0], chain: [][]*x509.Certificate{leafChain}}, nil
	}
	return nil, fmt.Errorf("no private key entry found in JKS keystore")
}

func parseJKSChain(entries []keystore.Certificate) ([]*x509.Certificate, error) {
	chain := make([]*x509.Certificate, 0, len(entries))
	for i, c := range entries {
		cert, err := x509.ParseCertificate(c.Content)
		if err != nil {
			return nil, fmt.Errorf("parse JKS certificate %d: %w", i, err)
		}
		chain = append(chain, cert)
	}
	return chain, nil
}
