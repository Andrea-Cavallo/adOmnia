//go:build windows

package resources

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// processTable legge padre e nome di tutti i processi con UNA snapshot Toolhelp. gopsutil ne faceva una
// per ogni nodo dell'albero (Children), cioè decine di enumerazioni complete del sistema a ogni campione.
func processTable() (map[int32]processInfo, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	table := map[int32]processInfo{}
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		table[int32(entry.ProcessID)] = processInfo{parent: int32(entry.ParentProcessID), name: windows.UTF16ToString(entry.ExeFile[:])}
	}
	return table, nil
}
