//go:build !windows

package vault

func protectKeyFile(data []byte) ([]byte, error) { return data, nil }
func openKeyFile(data []byte) ([]byte, error)    { return data, nil }
