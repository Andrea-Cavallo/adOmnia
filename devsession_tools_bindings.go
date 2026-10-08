package main

import "adomnia/internal/devsession"

// WatchKafka reads new messages of the given topics while the session runs.
func (d *DevSession) WatchKafka(sessionID string, brokers, topics []string) (devsession.SessionTools, error) {
	return d.tools.WatchKafka(sessionID, brokers, topics)
}

// UnwatchKafka stops the Kafka watch of a session.
func (d *DevSession) UnwatchKafka(sessionID string) devsession.SessionTools {
	return d.tools.UnwatchKafka(sessionID)
}

// StartSQLCapture opens a loopback proxy in front of the service's database.
// Point the service's DSN at the returned address to see its queries.
func (d *DevSession) StartSQLCapture(sessionID, kind, target string, port int) (devsession.SessionTools, error) {
	return d.tools.StartSQL(sessionID, kind, target, port)
}

// StopSQLCapture closes the SQL capture proxy of a session.
func (d *DevSession) StopSQLCapture(sessionID string) devsession.SessionTools {
	return d.tools.StopSQL(sessionID)
}

// Tools returns the capture tools attached to a session.
func (d *DevSession) Tools(sessionID string) devsession.SessionTools {
	return d.tools.Get(sessionID)
}
