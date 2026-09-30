package copilot

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"
)

const httpTimeout = 10 * time.Minute

// httpClient rispetta proxy e CA aziendale delle impostazioni. La verifica TLS non viene mai
// disattivata: un CA interno si aggiunge al trust store, non lo sostituisce.
func httpClient(settings Settings) (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if settings.Proxy.URL != "" {
		proxy, err := url.Parse(settings.Proxy.URL)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy: %w", err)
		}
		transport.Proxy = http.ProxyURL(proxy)
	} else {
		transport.Proxy = http.ProxyFromEnvironment
	}
	if settings.CABundlePath != "" {
		pool, err := certificatePool(settings.CABundlePath)
		if err != nil {
			return nil, err
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}
	}
	return &http.Client{Transport: transport, Timeout: httpTimeout}, nil
}

func certificatePool(bundlePath string) (*x509.CertPool, error) {
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	pem, err := os.ReadFile(bundlePath)
	if err != nil {
		return nil, fmt.Errorf("cannot read CA bundle: %w", err)
	}
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("CA bundle %s contains no PEM certificates", bundlePath)
	}
	return pool, nil
}
