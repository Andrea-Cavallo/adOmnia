package proxy

import (
	"adomnia/internal/httputil"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func generateCACert() error {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return fmt.Errorf("generate ca key: %w", err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return fmt.Errorf("generate serial: %w", err)
	}

	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "adOmnia Interception CA",
			Organization: []string{"adOmnia Local Proxy"},
		},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLenZero:        true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return fmt.Errorf("create ca cert: %w", err)
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})

	caMu.Lock()
	caCertPEM = certPEM
	caKeyPEM = keyPEM
	caMu.Unlock()

	saveCAToDisk(certPEM, keyPEM)
	return nil
}

func saveCAToDisk(certPEM, keyPEM []byte) {
	dir := dataDirectory
	os.WriteFile(filepath.Join(dir, "adomnia-ca.pem"), certPEM, 0600)
	os.WriteFile(filepath.Join(dir, "adomnia-ca-key.pem"), keyPEM, 0600)
}

func loadCAFromDisk() (certPEM, keyPEM []byte, ok bool) {
	dir := dataDirectory
	cert, err := os.ReadFile(filepath.Join(dir, "adomnia-ca.pem"))
	if err != nil {
		return nil, nil, false
	}
	key, err := os.ReadFile(filepath.Join(dir, "adomnia-ca-key.pem"))
	if err != nil {
		return nil, nil, false
	}
	return cert, key, true
}

// AutoLoadCA restores persisted certificate authority material on startup.
func AutoLoadCA() {
	if cert, key, ok := loadCAFromDisk(); ok {
		caMu.Lock()
		caCertPEM = cert
		caKeyPEM = key
		caMu.Unlock()
	}
}

func getOrCreateHostCert(host string) (*tls.Certificate, error) {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}

	hostCertCacheMu.RLock()
	if entry, ok := hostCertCache[host]; ok {
		if time.Since(entry.timestamp) < 1*time.Hour {
			cert := entry.cert
			hostCertCacheMu.RUnlock()
			return cert, nil
		}
	}
	hostCertCacheMu.RUnlock()

	caMu.RLock()
	if caCertPEM == nil || caKeyPEM == nil {
		caMu.RUnlock()
		return nil, fmt.Errorf("no CA certificate available")
	}
	caBlock, _ := pem.Decode(caCertPEM)
	if caBlock == nil {
		caMu.RUnlock()
		return nil, fmt.Errorf("failed to decode CA cert")
	}
	caCert, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		caMu.RUnlock()
		return nil, fmt.Errorf("parse CA cert: %w", err)
	}
	keyBlock, _ := pem.Decode(caKeyPEM)
	caKey, err := x509.ParsePKCS1PrivateKey(keyBlock.Bytes)
	caMu.RUnlock()
	if err != nil {
		return nil, fmt.Errorf("parse CA key: %w", err)
	}

	hostKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("generate host key: %w", err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("generate host serial: %w", err)
	}

	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName: host,
		},
		NotBefore: time.Now().Add(-1 * time.Hour),
		NotAfter:  time.Now().Add(24 * time.Hour),
		KeyUsage:  x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{
			x509.ExtKeyUsageServerAuth,
		},
		DNSNames:    []string{host},
		IPAddresses: resolveHostIPs(host),
	}

	hostDER, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &hostKey.PublicKey, caKey)
	if err != nil {
		return nil, fmt.Errorf("create host cert: %w", err)
	}

	hostCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: hostDER})
	hostKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(hostKey)})

	cert, err := tls.X509KeyPair(hostCertPEM, hostKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("load host keypair: %w", err)
	}

	hostCertCacheMu.Lock()
	if len(hostCertCache) > 500 {
		for k := range hostCertCache {
			delete(hostCertCache, k)
			if len(hostCertCache) <= 250 {
				break
			}
		}
	}
	hostCertCache[host] = &cachedHostCert{cert: &cert, timestamp: time.Now()}
	hostCertCacheMu.Unlock()

	return &cert, nil
}

func resolveHostIPs(host string) []net.IP {
	var ips []net.IP
	addrs, err := net.LookupIP(host)
	if err != nil {
		return ips
	}
	for _, addr := range addrs {
		if ip := addr.To4(); ip != nil {
			ips = append(ips, ip)
		} else if ip := addr.To16(); ip != nil {
			ips = append(ips, ip)
		}
	}
	return ips
}

// --- CA Lifecycle Handlers ---

func caStatusHandler(w http.ResponseWriter, r *http.Request) {
	caMu.RLock()
	exists := caCertPEM != nil
	caMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":     true,
		"exists": exists,
	})
}

func caGenerateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	hostCertCacheMu.Lock()
	hostCertCache = make(map[string]*cachedHostCert)
	hostCertCacheMu.Unlock()

	if err := generateCACert(); err != nil {
		httputil.JSONError(w, "failed to generate CA: "+err.Error(), 500)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func caExportHandler(w http.ResponseWriter, r *http.Request) {
	caMu.RLock()
	cert := caCertPEM
	caMu.RUnlock()

	if cert == nil {
		httputil.JSONError(w, "no CA certificate available", 404)
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" {
		format = "pem"
	}

	var content []byte
	var contentType, filename string

	switch format {
	case "crt", "der":
		block, _ := pem.Decode(cert)
		if block == nil {
			httputil.JSONError(w, "failed to decode CA cert", 500)
			return
		}
		content = block.Bytes
		contentType = "application/x-x509-ca-cert"
		filename = "adomnia-ca.crt"
	case "pem":
		content = cert
		contentType = "application/x-pem-file"
		filename = "adomnia-ca.pem"
	default:
		httputil.JSONError(w, "unsupported format: "+format+". Use pem or crt", 400)
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(content)))
	w.Write(content)
}

func caDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	caMu.Lock()
	caCertPEM = nil
	caKeyPEM = nil
	caMu.Unlock()

	dir := dataDirectory
	os.Remove(filepath.Join(dir, "adomnia-ca.pem"))
	os.Remove(filepath.Join(dir, "adomnia-ca-key.pem"))

	hostCertCacheMu.Lock()
	hostCertCache = make(map[string]*cachedHostCert)
	hostCertCacheMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}
