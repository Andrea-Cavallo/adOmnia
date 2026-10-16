package vault

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
)

// keyFileMagic marca il file della chiave di fallback protetto da macchina (DB-2.12).
// I file senza questo prefisso restano i vecchi file in chiaro da 32 byte.
var keyFileMagic = []byte("ADK1")

// wrapKeyFile protegge la chiave di fallback con una chiave derivata dall'identità della
// macchina: un backup o una fuga della sola config-dir non basta più per leggerla, come
// già succede con DPAPI su Windows. Senza identità (secret vuoto) il dato resta com'è.
func wrapKeyFile(data, secret []byte) []byte {
	if len(secret) == 0 {
		return data
	}
	block, err := aes.NewCipher(secret)
	if err != nil {
		return data
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return data
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return data
	}
	return append(append([]byte(nil), keyFileMagic...), gcm.Seal(nonce, nonce, data, keyFileMagic)...)
}

// unwrapKeyFile apre una chiave protetta da `wrapKeyFile`. I vecchi file in chiaro da
// 32 byte passano invariati; senza identità della macchina il file protetto non si apre
// (meglio un errore esplicito che sostituire la chiave e perdere le credenziali).
func unwrapKeyFile(data, secret []byte) ([]byte, error) {
	if len(data) == 32 && !bytes.HasPrefix(data, keyFileMagic) {
		return data, nil
	}
	if !bytes.HasPrefix(data, keyFileMagic) || len(secret) == 0 {
		return nil, errors.New("database encryption key is unreadable")
	}
	block, err := aes.NewCipher(secret)
	if err != nil {
		return nil, errors.New("database encryption key is unreadable")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errors.New("database encryption key is unreadable")
	}
	payload := data[len(keyFileMagic):]
	if len(payload) < gcm.NonceSize()+gcm.Overhead() {
		return nil, errors.New("database encryption key is unreadable")
	}
	plain, err := gcm.Open(nil, payload[:gcm.NonceSize()], payload[gcm.NonceSize():], keyFileMagic)
	if err != nil {
		return nil, errors.New("database encryption key is unreadable")
	}
	return plain, nil
}
