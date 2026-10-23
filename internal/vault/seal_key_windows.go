//go:build windows

package vault

import (
	"golang.org/x/sys/windows"
	"unsafe"
)

func protectKeyFile(data []byte) ([]byte, error) {
	input := windows.DataBlob{Size: uint32(len(data)), Data: &data[0]}
	var output windows.DataBlob
	if err := windows.CryptProtectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output); err != nil {
		return nil, err
	}
	defer func() { _, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data))) }() // nosemgrep: go.lang.security.audit.unsafe.use-of-unsafe-block -- required for Win32/cgo interop
	return append([]byte(nil), unsafe.Slice(output.Data, output.Size)...), nil               // nosemgrep: go.lang.security.audit.unsafe.use-of-unsafe-block -- required for Win32/cgo interop
}
func openKeyFile(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, windows.ERROR_INVALID_DATA
	}
	input := windows.DataBlob{Size: uint32(len(data)), Data: &data[0]}
	var output windows.DataBlob
	if err := windows.CryptUnprotectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output); err != nil {
		return nil, err
	}
	defer func() { _, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data))) }() // nosemgrep: go.lang.security.audit.unsafe.use-of-unsafe-block -- required for Win32/cgo interop
	return append([]byte(nil), unsafe.Slice(output.Data, output.Size)...), nil               // nosemgrep: go.lang.security.audit.unsafe.use-of-unsafe-block -- required for Win32/cgo interop
}
