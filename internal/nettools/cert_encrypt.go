package nettools

import (
	"crypto"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/youmark/pkcs8"
)

// Cifratura locale delle chiavi private PEM: PKCS#8 cifrato con PBES2
// (PBKDF2-HMAC-SHA256 + AES-256-CBC), leggibile da OpenSSL, Java e Go.
// Equivale a `openssl pkcs8 -topk8 -v2 aes-256-cbc -v2prf hmacWithSHA256`.

const (
	minKeyPasswordLength = 8
	// Iterazioni PBKDF2-SHA256 consigliate da OWASP (2023): circa mezzo secondo, una volta sola.
	keyEncryptionIterations = 600_000
	maxPEMInputBytes        = 1 << 20
)

var keyEncryptionOpts = &pkcs8.Opts{
	Cipher:  pkcs8.AES256CBC,
	KDFOpts: pkcs8.PBKDF2Opts{SaltSize: 16, IterationCount: keyEncryptionIterations, HMACHash: crypto.SHA256},
}

// transformPrivateKeys cifra o decifra ogni chiave privata del testo PEM,
// lasciando invariati certificati e altri blocchi. Restituisce quante chiavi ha trasformato.
func transformPrivateKeys(text, password string, encrypt bool) (string, int, error) {
	if len(text) > maxPEMInputBytes {
		return "", 0, errors.New("PEM troppo grande (massimo 1 MB)")
	}
	if encrypt && len(password) < minKeyPasswordLength {
		return "", 0, fmt.Errorf("la password deve avere almeno %d caratteri", minKeyPasswordLength)
	}
	if !encrypt && password == "" {
		return "", 0, errors.New("indica la password della chiave cifrata")
	}
	rest := []byte(text)
	var out strings.Builder
	transformed := 0
	for {
		block, remaining := pem.Decode(rest)
		if block == nil {
			break
		}
		rest = remaining
		next, changed, err := transformBlock(block, password, encrypt)
		if err != nil {
			return "", 0, err
		}
		if changed {
			transformed++
		}
		if err := pem.Encode(&out, next); err != nil {
			return "", 0, err
		}
	}
	if out.Len() == 0 {
		return "", 0, errors.New("nessun blocco PEM trovato")
	}
	if transformed == 0 {
		if encrypt {
			return "", 0, errors.New("nessuna chiave privata in chiaro da cifrare (i certificati sono pubblici; le chiavi già cifrate restano come sono)")
		}
		return "", 0, errors.New("nessuna chiave privata cifrata (ENCRYPTED PRIVATE KEY) da decifrare")
	}
	return out.String(), transformed, nil
}

func transformBlock(block *pem.Block, password string, encrypt bool) (*pem.Block, bool, error) {
	if encrypt {
		key, ok, err := plainPrivateKey(block)
		if !ok || err != nil {
			return block, false, err
		}
		der, err := pkcs8.MarshalPrivateKey(key, []byte(password), keyEncryptionOpts)
		if err != nil {
			return nil, false, fmt.Errorf("cifratura della chiave fallita: %w", err)
		}
		return &pem.Block{Type: "ENCRYPTED PRIVATE KEY", Bytes: der}, true, nil
	}
	if block.Type != "ENCRYPTED PRIVATE KEY" {
		return block, false, nil
	}
	key, err := pkcs8.ParsePKCS8PrivateKey(block.Bytes, []byte(password))
	if err != nil {
		return nil, false, errors.New("password errata o chiave cifrata non supportata")
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, false, fmt.Errorf("conversione della chiave fallita: %w", err)
	}
	return &pem.Block{Type: "PRIVATE KEY", Bytes: der}, true, nil
}

// plainPrivateKey riconosce le chiavi private in chiaro nei formati PKCS#8, PKCS#1 e SEC 1.
func plainPrivateKey(block *pem.Block) (any, bool, error) {
	if len(block.Headers) > 0 && block.Headers["Proc-Type"] != "" {
		return nil, false, errors.New("chiave cifrata con il vecchio formato OpenSSL (Proc-Type): decifrala prima con openssl")
	}
	var (
		key any
		err error
	)
	switch block.Type {
	case "PRIVATE KEY":
		key, err = x509.ParsePKCS8PrivateKey(block.Bytes)
	case "RSA PRIVATE KEY":
		key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
	case "EC PRIVATE KEY":
		key, err = x509.ParseECPrivateKey(block.Bytes)
	default:
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("chiave %s non leggibile: %w", strings.ToLower(block.Type), err)
	}
	return key, true, nil
}

type pemEncryptRequest struct {
	PEM      string `json:"pem"`
	Password string `json:"password"`
	Mode     string `json:"mode"`
}

type pemEncryptResponse struct {
	PEM  string `json:"pem"`
	Keys int    `json:"keys"`
}

// certPemEncryptHandler: POST {pem, password, mode: "encrypt"|"decrypt"} → {pem, keys}.
// La password non viene mai registrata né restituita.
func certPemEncryptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var request pemEncryptRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxPEMInputBytes+4096)).Decode(&request); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if request.Mode != "encrypt" && request.Mode != "decrypt" {
		http.Error(w, "mode must be encrypt or decrypt", http.StatusBadRequest)
		return
	}
	text, keys, err := transformPrivateKeys(request.PEM, request.Password, request.Mode == "encrypt")
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(pemEncryptResponse{PEM: text, Keys: keys})
}
