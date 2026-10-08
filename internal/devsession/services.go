package devsession

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"adomnia/internal/nettools"
	"adomnia/internal/storage"
)

const (
	servicesBucket = "devsession"
	servicesKey    = "services"
)

// ServiceNames maps a project root to its declared service name
// ("users-service"), persisted in the local DB.
type ServiceNames struct {
	mu    sync.Mutex
	names map[string]string
}

func LoadServiceNames() *ServiceNames {
	names := map[string]string{}
	if data, err := storage.Get(servicesBucket, servicesKey); err == nil && len(data) > 0 {
		_ = json.Unmarshal(data, &names)
	}
	return &ServiceNames{names: names}
}

func (s *ServiceNames) Get(root string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.names[root]
}

// Set declares (or, with an empty name, forgets) the service name of a root.
func (s *ServiceNames) Set(root, name string) error {
	name = strings.TrimSpace(name)
	s.mu.Lock()
	if name == "" {
		delete(s.names, root)
	} else {
		s.names[root] = name
	}
	data, _ := json.Marshal(s.names)
	s.mu.Unlock()
	return storage.Put(servicesBucket, servicesKey, data)
}

// ListLocalPorts returns the listening sockets of the machine.
func ListLocalPorts() ([]Port, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	entries, err := nettools.ListListeningPorts(ctx)
	if err != nil {
		return nil, err
	}
	ports := make([]Port, 0, len(entries))
	for _, entry := range entries {
		ports = append(ports, Port{Port: entry.Port, PID: entry.PID, Process: entry.Process})
	}
	return ports, nil
}
