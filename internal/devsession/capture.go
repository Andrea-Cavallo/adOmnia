package devsession

import (
	"fmt"
	"sync"
)

// SessionTools reports the capture tools attached to a live session.
type SessionTools struct {
	Kafka *KafkaWatch `json:"kafka,omitempty"`
	SQL   *SQLProxy   `json:"sql,omitempty"`
}

// CaptureTools owns at most one Kafka watch and one SQL proxy per live session.
type CaptureTools struct {
	manager *Manager
	mu      sync.Mutex
	watches map[string]*KafkaWatch
	proxies map[string]*SQLProxy
}

func NewCaptureTools(manager *Manager) *CaptureTools {
	return &CaptureTools{manager: manager, watches: map[string]*KafkaWatch{}, proxies: map[string]*SQLProxy{}}
}

var errNotRunning = fmt.Errorf("the service is not running")

// WatchKafka reads new messages of the given topics while the session runs.
func (c *CaptureTools) WatchKafka(sessionID string, brokers, topics []string) (SessionTools, error) {
	if !c.manager.IsLive(sessionID) {
		return SessionTools{}, errNotRunning
	}
	c.UnwatchKafka(sessionID)
	watch, err := StartKafkaWatch(brokers, topics, func(message Message) {
		message.SessionID = sessionID
		c.manager.RecordMessage(message)
	})
	if err != nil {
		return SessionTools{}, err
	}
	c.mu.Lock()
	old := c.watches[sessionID]
	c.watches[sessionID] = watch
	c.mu.Unlock()
	if old != nil {
		go old.Close() // a concurrent start won the race
	}
	if !c.manager.IsLive(sessionID) { // the service stopped while the watch was starting
		c.UnwatchKafka(sessionID)
		return SessionTools{}, errNotRunning
	}
	return c.Get(sessionID), nil
}

// UnwatchKafka stops the Kafka watch of a session.
func (c *CaptureTools) UnwatchKafka(sessionID string) SessionTools {
	c.mu.Lock()
	watch := c.watches[sessionID]
	delete(c.watches, sessionID)
	c.mu.Unlock()
	if watch != nil {
		go watch.Close()
	}
	return c.Get(sessionID)
}

// StartSQL opens a loopback proxy in front of the service's database.
func (c *CaptureTools) StartSQL(sessionID, kind, target string, port int) (SessionTools, error) {
	if !c.manager.IsLive(sessionID) {
		return SessionTools{}, errNotRunning
	}
	c.StopSQL(sessionID)
	proxy, err := StartSQLProxy(kind, target, port, func(statement Statement) {
		c.manager.RecordStatement(sessionID, kind+"://"+target, statement)
	})
	if err != nil {
		return SessionTools{}, err
	}
	c.mu.Lock()
	old := c.proxies[sessionID]
	c.proxies[sessionID] = proxy
	c.mu.Unlock()
	if old != nil {
		go old.Close()
	}
	if !c.manager.IsLive(sessionID) {
		c.StopSQL(sessionID)
		return SessionTools{}, errNotRunning
	}
	return c.Get(sessionID), nil
}

// StopSQL closes the SQL capture proxy of a session.
func (c *CaptureTools) StopSQL(sessionID string) SessionTools {
	c.mu.Lock()
	proxy := c.proxies[sessionID]
	delete(c.proxies, sessionID)
	c.mu.Unlock()
	if proxy != nil {
		go proxy.Close()
	}
	return c.Get(sessionID)
}

// StopAll closes every tool of a session.
func (c *CaptureTools) StopAll(sessionID string) {
	c.UnwatchKafka(sessionID)
	c.StopSQL(sessionID)
}

// Get returns the capture tools attached to a session.
func (c *CaptureTools) Get(sessionID string) SessionTools {
	c.mu.Lock()
	defer c.mu.Unlock()
	return SessionTools{Kafka: c.watches[sessionID], SQL: c.proxies[sessionID]}
}

// IsLive reports whether a session exists and has not ended.
func (m *Manager) IsLive(sessionID string) bool {
	for _, session := range m.Snapshot().Sessions {
		if session.ID == sessionID && session.EndedAt == nil {
			return true
		}
	}
	return false
}
