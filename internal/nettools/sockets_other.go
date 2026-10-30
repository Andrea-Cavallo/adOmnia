//go:build !windows

package nettools

import (
	"context"
	"errors"
)

// ListTCPSockets collects the established and listening sockets for observers.
func ListTCPSockets(ctx context.Context) ([]Connection, []PortEntry, error) {
	connections, connectionErr := ListEstablished(ctx)
	listeners, listenerErr := ListListeningPorts(ctx)
	return connections, listeners, errors.Join(connectionErr, listenerErr)
}
