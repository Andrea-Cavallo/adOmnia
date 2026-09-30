package main

import (
	"fmt"
	"sync"

	"adomnia/internal/devsession"
)

// brokerWatchers owns at most one Kafka watch per live session.
type brokerWatchers struct {
	mu      sync.Mutex
	manager *devsession.Manager
	watches map[string]*devsession.KafkaWatch
}

func newBrokerWatchers(manager *devsession.Manager) *brokerWatchers {
	return &brokerWatchers{manager: manager, watches: map[string]*devsession.KafkaWatch{}}
}

func (b *brokerWatchers) start(sessionID string, brokers, topics []string) (*devsession.KafkaWatch, error) {
	b.stop(sessionID)
	watch, err := devsession.StartKafkaWatch(brokers, topics, func(message devsession.Message) {
		message.SessionID = sessionID
		b.manager.RecordMessage(message)
	})
	if err != nil {
		return nil, err
	}
	b.mu.Lock()
	old := b.watches[sessionID]
	b.watches[sessionID] = watch
	b.mu.Unlock()
	if old != nil {
		go old.Close() // a concurrent start won the race
	}
	return watch, nil
}

func (b *brokerWatchers) stop(sessionID string) {
	b.mu.Lock()
	watch := b.watches[sessionID]
	delete(b.watches, sessionID)
	b.mu.Unlock()
	if watch != nil {
		go watch.Close()
	}
}

func (b *brokerWatchers) get(sessionID string) *devsession.KafkaWatch {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.watches[sessionID]
}

// sqlProxies owns at most one SQL capture proxy per live session.
type sqlProxies struct {
	mu      sync.Mutex
	manager *devsession.Manager
	proxies map[string]*devsession.SQLProxy
}

func newSQLProxies(manager *devsession.Manager) *sqlProxies {
	return &sqlProxies{manager: manager, proxies: map[string]*devsession.SQLProxy{}}
}

func (s *sqlProxies) start(sessionID, kind, target string, port int) (*devsession.SQLProxy, error) {
	s.stop(sessionID)
	proxy, err := devsession.StartSQLProxy(kind, target, port, func(sql string) {
		s.manager.RecordQuery(sessionID, kind+"://"+target, sql)
	})
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	old := s.proxies[sessionID]
	s.proxies[sessionID] = proxy
	s.mu.Unlock()
	if old != nil {
		go old.Close()
	}
	return proxy, nil
}

func (s *sqlProxies) stop(sessionID string) {
	s.mu.Lock()
	proxy := s.proxies[sessionID]
	delete(s.proxies, sessionID)
	s.mu.Unlock()
	if proxy != nil {
		go proxy.Close()
	}
}

func (s *sqlProxies) get(sessionID string) *devsession.SQLProxy {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.proxies[sessionID]
}

// SessionTools reports the capture tools attached to a live session.
type SessionTools struct {
	Kafka *devsession.KafkaWatch `json:"kafka,omitempty"`
	SQL   *devsession.SQLProxy   `json:"sql,omitempty"`
}

// WatchKafka reads new messages of the given topics while the session runs.
func (d *DevSession) WatchKafka(sessionID string, brokers, topics []string) (SessionTools, error) {
	if !d.isLive(sessionID) {
		return SessionTools{}, fmt.Errorf("the service is not running")
	}
	if _, err := d.watchers.start(sessionID, brokers, topics); err != nil {
		return SessionTools{}, err
	}
	if !d.isLive(sessionID) { // the service stopped while the watch was starting
		d.watchers.stop(sessionID)
		return SessionTools{}, fmt.Errorf("the service is not running")
	}
	return d.Tools(sessionID), nil
}

// UnwatchKafka stops the Kafka watch of a session.
func (d *DevSession) UnwatchKafka(sessionID string) SessionTools {
	d.watchers.stop(sessionID)
	return d.Tools(sessionID)
}

// StartSQLCapture opens a loopback proxy in front of the service's database.
// Point the service's DSN at the returned address to see its queries.
func (d *DevSession) StartSQLCapture(sessionID, kind, target string, port int) (SessionTools, error) {
	if !d.isLive(sessionID) {
		return SessionTools{}, fmt.Errorf("the service is not running")
	}
	if _, err := d.proxies.start(sessionID, kind, target, port); err != nil {
		return SessionTools{}, err
	}
	if !d.isLive(sessionID) {
		d.proxies.stop(sessionID)
		return SessionTools{}, fmt.Errorf("the service is not running")
	}
	return d.Tools(sessionID), nil
}

// StopSQLCapture closes the SQL capture proxy of a session.
func (d *DevSession) StopSQLCapture(sessionID string) SessionTools {
	d.proxies.stop(sessionID)
	return d.Tools(sessionID)
}

// Tools returns the capture tools attached to a session.
func (d *DevSession) Tools(sessionID string) SessionTools {
	return SessionTools{Kafka: d.watchers.get(sessionID), SQL: d.proxies.get(sessionID)}
}

func (d *DevSession) isLive(sessionID string) bool {
	for _, session := range d.manager.Snapshot().Sessions {
		if session.ID == sessionID && session.EndedAt == nil {
			return true
		}
	}
	return false
}
