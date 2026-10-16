//go:build !windows

package vault

import (
	"bytes"
	"crypto/sha256"
	"os"
	"strconv"
)

// machineSecret lega la chiave di fallback a macchina e utente (DB-2.12), lo stesso
// contratto che DPAPI dà su Windows. Vuoto quando l'identità non è leggibile (es. macOS
// senza machine-id): il file resta 0600 in chiaro e l'avviso `credentialWarning`
// dell'interfaccia lo dice già.
func machineSecret() []byte {
	var id string
	for _, candidate := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
		if data, err := os.ReadFile(candidate); err == nil && len(bytes.TrimSpace(data)) > 0 {
			id = string(bytes.TrimSpace(data))
			break
		}
	}
	if id == "" {
		return nil
	}
	sum := sha256.Sum256([]byte(id + "\x00adomnia.database.master.v1\x00" + strconv.Itoa(os.Getuid())))
	return sum[:]
}

func protectKeyFile(data []byte) ([]byte, error) {
	return wrapKeyFile(data, machineSecret()), nil
}

func openKeyFile(data []byte) ([]byte, error) {
	return unwrapKeyFile(data, machineSecret())
}
