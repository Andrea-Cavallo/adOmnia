package milk

import (
	"testing"
	"time"
)

func TestMarkIdle(t *testing.T) {
	running := &process{}
	m := &Manager{current: running, turns: map[string]string{}, pending: map[string]*permission{}, lastUsed: time.Now()}
	if m.markIdle(running) {
		t.Fatal("fresh agent reaped")
	}
	m.lastUsed = time.Now().Add(-idleLimit - time.Second)
	m.turns["s"] = "t"
	if m.markIdle(running) {
		t.Fatal("agent with a running turn reaped")
	}
	delete(m.turns, "s")
	if !m.markIdle(running) || !m.idleStopped {
		t.Fatal("idle agent not reaped")
	}
}
