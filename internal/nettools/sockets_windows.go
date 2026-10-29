//go:build windows

package nettools

import (
	"context"
	"encoding/binary"
	"fmt"
	"net"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var getExtendedTCPTable = windows.NewLazySystemDLL("iphlpapi.dll").NewProc("GetExtendedTcpTable")

// ListTCPSockets reads a current IPv4/IPv6 snapshot without shell commands.
func ListTCPSockets(ctx context.Context) ([]Connection, []PortEntry, error) {
	var connections []Connection
	var listeners []PortEntry
	for _, family := range []uint32{windows.AF_INET, windows.AF_INET6} {
		table, err := tcpOwnerTable(ctx, family, 4)
		if err != nil {
			return nil, nil, err
		}
		conns, _, err := decodeTCPOwnerTable(table, family, false)
		if err != nil {
			return nil, nil, err
		}
		connections = append(connections, conns...)
		// Ask Windows to classify listeners; do not infer them from displayed state labels.
		table, err = tcpOwnerTable(ctx, family, 3)
		if err != nil {
			return nil, nil, err
		}
		_, ports, err := decodeTCPOwnerTable(table, family, true)
		if err != nil {
			return nil, nil, err
		}
		listeners = append(listeners, ports...)
	}
	return connections, listeners, nil
}

func tcpOwnerTable(ctx context.Context, family, tableClass uint32) ([]byte, error) {
	size := uint32(4)
	table := make([]byte, 4)
	for range 5 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		// TCP_TABLE_OWNER_PID_CONNECTIONS=4; TCP_TABLE_OWNER_PID_LISTENER=3.
		status, _, _ := getExtendedTCPTable.Call(uintptr(unsafe.Pointer(&table[0])), uintptr(unsafe.Pointer(&size)), 1, uintptr(family), uintptr(tableClass), 0)
		runtime.KeepAlive(table)
		if status == 0 {
			if size < 4 || uint64(size) > uint64(len(table)) {
				return nil, fmt.Errorf("invalid TCP table result size: %d", size)
			}
			return table[:size], nil
		}
		if syscall.Errno(status) != windows.ERROR_INSUFFICIENT_BUFFER {
			return nil, fmt.Errorf("GetExtendedTcpTable: %w", syscall.Errno(status))
		}
		if size < 4 || size > 64<<20 {
			return nil, fmt.Errorf("invalid TCP table size: %d", size)
		}
		table = make([]byte, size)
	}
	return nil, fmt.Errorf("TCP table changed too often while reading")
}

func decodeTCPOwnerTable(table []byte, family uint32, listenerTable bool) ([]Connection, []PortEntry, error) {
	rowSize, localAddress, localPort, remoteAddress, remotePort, state, pid := 24, 4, 8, 12, 16, 0, 20
	addressSize := 4
	if family == windows.AF_INET6 {
		rowSize, localAddress, localPort, remoteAddress, remotePort, state, pid = 56, 0, 20, 24, 44, 48, 52
		addressSize = 16
	}
	if len(table) < 4 {
		return nil, nil, fmt.Errorf("truncated TCP table")
	}
	count := binary.LittleEndian.Uint32(table[:4])
	if uint64(count) > uint64((len(table)-4)/rowSize) {
		return nil, nil, fmt.Errorf("truncated TCP rows")
	}
	var connections []Connection
	var listeners []PortEntry
	for index := uint32(0); index < count; index++ {
		row := table[4+int(index)*rowSize : 4+(int(index)+1)*rowSize]
		owner := int(binary.LittleEndian.Uint32(row[pid:]))
		port := int(binary.BigEndian.Uint16(row[localPort:]))
		socketState := binary.LittleEndian.Uint32(row[state:])
		if listenerTable {
			socketState = 2
		}
		switch socketState {
		case 2: // MIB_TCP_STATE_LISTEN
			if !listenerTable {
				continue
			}
			listeners = append(listeners, PortEntry{Protocol: "tcp", Address: net.IP(row[localAddress : localAddress+addressSize]).String(), Port: port, PID: owner})
		case 5: // MIB_TCP_STATE_ESTAB
			connections = append(connections, Connection{LocalPort: port, RemoteHost: net.IP(row[remoteAddress : remoteAddress+addressSize]).String(), RemotePort: int(binary.BigEndian.Uint16(row[remotePort:])), PID: owner})
		}
	}
	return connections, listeners, nil
}
