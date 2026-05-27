package nettools

import (
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ── Certificate Inspect ──────────────────────────────────────────────────────

type rdnFields struct {
	CN string `json:"cn,omitempty"`
	O  string `json:"o,omitempty"`
	OU string `json:"ou,omitempty"`
	C  string `json:"c,omitempty"`
	ST string `json:"st,omitempty"`
	L  string `json:"l,omitempty"`
}

type certInspectResult struct {
	Error              string    `json:"error,omitempty"`
	BlockType          string    `json:"blockType"`
	Subject            rdnFields `json:"subject"`
	Issuer             rdnFields `json:"issuer"`
	SerialNumber       string    `json:"serialNumber,omitempty"`
	NotBefore          string    `json:"notBefore,omitempty"`
	NotAfter           string    `json:"notAfter,omitempty"`
	SignatureAlgorithm string    `json:"signatureAlgorithm,omitempty"`
	PublicKeyAlgorithm string    `json:"publicKeyAlgorithm,omitempty"`
	KeyBits            int       `json:"keyBits,omitempty"`
	SANs               []string  `json:"sans"`
	KeyUsage           []string  `json:"keyUsage"`
	ExtKeyUsage        []string  `json:"extKeyUsage"`
	SHA256Fingerprint  string    `json:"sha256,omitempty"`
	SHA1Fingerprint    string    `json:"sha1,omitempty"`
	IsCA               bool      `json:"isCA"`
	IsExpired          bool      `json:"isExpired"`
	IsNotYetValid      bool      `json:"isNotYetValid"`
	DaysRemaining      int       `json:"daysRemaining"`
}

func colonHex(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	parts := make([]string, len(b))
	for i, v := range b {
		parts[i] = fmt.Sprintf("%02x", v)
	}
	return strings.Join(parts, ":")
}

func certKeyUsageNames(u x509.KeyUsage) []string {
	var names []string
	bits := []struct {
		mask x509.KeyUsage
		name string
	}{
		{x509.KeyUsageDigitalSignature, "Digital Signature"},
		{x509.KeyUsageContentCommitment, "Content Commitment"},
		{x509.KeyUsageKeyEncipherment, "Key Encipherment"},
		{x509.KeyUsageDataEncipherment, "Data Encipherment"},
		{x509.KeyUsageKeyAgreement, "Key Agreement"},
		{x509.KeyUsageCertSign, "Certificate Sign"},
		{x509.KeyUsageCRLSign, "CRL Sign"},
		{x509.KeyUsageEncipherOnly, "Encipher Only"},
		{x509.KeyUsageDecipherOnly, "Decipher Only"},
	}
	for _, b := range bits {
		if u&b.mask != 0 {
			names = append(names, b.name)
		}
	}
	return names
}

func certExtKeyUsageNames(usages []x509.ExtKeyUsage) []string {
	var names []string
	for _, u := range usages {
		switch u {
		case x509.ExtKeyUsageServerAuth:
			names = append(names, "TLS Server Authentication")
		case x509.ExtKeyUsageClientAuth:
			names = append(names, "TLS Client Authentication")
		case x509.ExtKeyUsageCodeSigning:
			names = append(names, "Code Signing")
		case x509.ExtKeyUsageEmailProtection:
			names = append(names, "Email Protection")
		case x509.ExtKeyUsageTimeStamping:
			names = append(names, "Time Stamping")
		case x509.ExtKeyUsageOCSPSigning:
			names = append(names, "OCSP Signing")
		default:
			names = append(names, fmt.Sprintf("ExtKeyUsage(%d)", u))
		}
	}
	return names
}

func parseCertToResult(cert *x509.Certificate) certInspectResult {
	now := time.Now()

	// Fingerprints
	sha256sum := sha256.Sum256(cert.Raw)
	sha1sum := sha1.Sum(cert.Raw)

	// Key bits
	keyBits := 0
	switch k := cert.PublicKey.(type) {
	case *rsa.PublicKey:
		keyBits = k.N.BitLen()
	case *ecdsa.PublicKey:
		keyBits = k.Curve.Params().BitSize
	}

	// SANs
	sans := make([]string, 0)
	for _, dns := range cert.DNSNames {
		sans = append(sans, "DNS: "+dns)
	}
	for _, ip := range cert.IPAddresses {
		sans = append(sans, "IP: "+ip.String())
	}
	for _, email := range cert.EmailAddresses {
		sans = append(sans, "Email: "+email)
	}
	for _, uri := range cert.URIs {
		sans = append(sans, "URI: "+uri.String())
	}

	// Serial as colon-separated hex bytes
	serialBytes := cert.SerialNumber.Bytes()
	if len(serialBytes) == 0 {
		serialBytes = []byte{0}
	}

	// Days remaining
	daysRemaining := int(cert.NotAfter.Sub(now).Hours() / 24)

	subj := rdnFields{
		CN: cert.Subject.CommonName,
		O:  strings.Join(cert.Subject.Organization, ", "),
		OU: strings.Join(cert.Subject.OrganizationalUnit, ", "),
		C:  strings.Join(cert.Subject.Country, ", "),
		ST: strings.Join(cert.Subject.Province, ", "),
		L:  strings.Join(cert.Subject.Locality, ", "),
	}
	iss := rdnFields{
		CN: cert.Issuer.CommonName,
		O:  strings.Join(cert.Issuer.Organization, ", "),
		OU: strings.Join(cert.Issuer.OrganizationalUnit, ", "),
		C:  strings.Join(cert.Issuer.Country, ", "),
		ST: strings.Join(cert.Issuer.Province, ", "),
		L:  strings.Join(cert.Issuer.Locality, ", "),
	}

	return certInspectResult{
		BlockType:          "CERTIFICATE",
		Subject:            subj,
		Issuer:             iss,
		SerialNumber:       colonHex(serialBytes),
		NotBefore:          cert.NotBefore.UTC().Format("2006-01-02 15:04:05 UTC"),
		NotAfter:           cert.NotAfter.UTC().Format("2006-01-02 15:04:05 UTC"),
		SignatureAlgorithm: cert.SignatureAlgorithm.String(),
		PublicKeyAlgorithm: cert.PublicKeyAlgorithm.String(),
		KeyBits:            keyBits,
		SANs:               sans,
		KeyUsage:           certKeyUsageNames(cert.KeyUsage),
		ExtKeyUsage:        certExtKeyUsageNames(cert.ExtKeyUsage),
		SHA256Fingerprint:  colonHex(sha256sum[:]),
		SHA1Fingerprint:    colonHex(sha1sum[:]),
		IsCA:               cert.IsCA,
		IsExpired:          now.After(cert.NotAfter),
		IsNotYetValid:      now.Before(cert.NotBefore),
		DaysRemaining:      daysRemaining,
	}
}

func certInspectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "failed to read body: "+err.Error(), http.StatusBadRequest)
		return
	}
	pemData := strings.TrimSpace(string(body))
	if pemData == "" {
		http.Error(w, "empty PEM data", http.StatusBadRequest)
		return
	}

	var results []certInspectResult
	rest := []byte(pemData)
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			results = append(results, certInspectResult{
				BlockType: block.Type,
				SANs:      []string{},
				KeyUsage:  []string{},
				ExtKeyUsage: []string{},
				Error:     "Not a CERTIFICATE block — keys and CSRs cannot be inspected here",
			})
			continue
		}
		cert, parseErr := x509.ParseCertificate(block.Bytes)
		if parseErr != nil {
			results = append(results, certInspectResult{
				BlockType: "CERTIFICATE",
				SANs:      []string{},
				KeyUsage:  []string{},
				ExtKeyUsage: []string{},
				Error:     "Failed to parse: " + parseErr.Error(),
			})
			continue
		}
		results = append(results, parseCertToResult(cert))
	}

	if len(results) == 0 {
		http.Error(w, "no PEM blocks found in input", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func writeTempPassword(dir, password string) (string, error) {
	f, err := os.CreateTemp(dir, "pass-*")
	if err != nil {
		return "", err
	}
	if _, err := f.WriteString(password); err != nil {
		f.Close()
		return "", err
	}
	f.Close()
	return f.Name(), nil
}

func certJksSplitHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "invalid multipart form: "+err.Error(), http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("jks")
	if err != nil {
		http.Error(w, "jks file required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	password := r.FormValue("password")
	if password == "" {
		password = "changeit"
	}
	alias := strings.TrimSpace(r.FormValue("alias"))

	keytool, err := exec.LookPath("keytool")
	if err != nil {
		http.Error(w, "keytool not found in PATH. Install a JDK and retry.", http.StatusFailedDependency)
		return
	}
	openssl, err := exec.LookPath("openssl")
	if err != nil {
		http.Error(w, "openssl not found in PATH. Install OpenSSL and retry.", http.StatusFailedDependency)
		return
	}

	dir, err := os.MkdirTemp("", "adomnia-jks-*")
	if err != nil {
		http.Error(w, "temp dir failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(dir)

	jksPath := filepath.Join(dir, "input.jks")
	p12Path := filepath.Join(dir, "output.p12")
	certPath := filepath.Join(dir, "cert.pem")
	keyPath := filepath.Join(dir, "key.pem")

	out, err := os.Create(jksPath)
	if err != nil {
		http.Error(w, "temp file failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := io.Copy(out, io.LimitReader(file, 32<<20)); err != nil {
		out.Close()
		http.Error(w, "failed to save upload: "+err.Error(), http.StatusBadRequest)
		return
	}
	out.Close()

	srcPassFile, err := writeTempPassword(dir, password)
	if err != nil {
		http.Error(w, "temp password file failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	args := []string{
		"-importkeystore",
		"-srckeystore", jksPath,
		"-srcstoretype", "JKS",
		"-srcstorepass:file", srcPassFile,
		"-destkeystore", p12Path,
		"-deststoretype", "PKCS12",
		"-deststorepass:file", srcPassFile,
		"-destkeypass:file", srcPassFile,
		"-noprompt",
	}
	if alias != "" {
		args = append(args, "-srcalias", alias, "-destalias", alias)
	}
	if output, err := exec.Command(keytool, args...).CombinedOutput(); err != nil {
		http.Error(w, fmt.Sprintf("keytool conversion failed: %s", sanitizeOutput(strings.TrimSpace(string(output)), password)), http.StatusBadRequest)
		return
	}

	if output, err := exec.Command(openssl, "pkcs12", "-in", p12Path, "-clcerts", "-nokeys", "-out", certPath, "-passin", "file:"+srcPassFile).CombinedOutput(); err != nil {
		http.Error(w, fmt.Sprintf("certificate export failed: %s", sanitizeOutput(strings.TrimSpace(string(output)), password)), http.StatusBadRequest)
		return
	}
	if output, err := exec.Command(openssl, "pkcs12", "-in", p12Path, "-nocerts", "-nodes", "-out", keyPath, "-passin", "file:"+srcPassFile).CombinedOutput(); err != nil {
		http.Error(w, fmt.Sprintf("key export failed: %s", sanitizeOutput(strings.TrimSpace(string(output)), password)), http.StatusBadRequest)
		return
	}

	certPEM, _ := os.ReadFile(certPath)
	keyPEM, _ := os.ReadFile(keyPath)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":        true,
		"fileName":  header.Filename,
		"certPem":   string(certPEM),
		"keyPem":    string(keyPEM),
		"createdAt": time.Now().UTC().Format(time.RFC3339),
		"warning":   "Private keys are extracted locally only. Protect the downloaded PEM files.",
	})
}

func sanitizeOutput(output, password string) string {
	if password == "" || password == "changeit" {
		return output
	}
	return strings.ReplaceAll(output, password, "***")
}
