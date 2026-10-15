package database

import (
	"context"
	"testing"
	"time"
)

func TestManagerReusesClientAndDisconnects(t *testing.T) {
	m := newConnectionManager()
	defer m.Close()
	cfg := dbConnectionRequest{ID: "test", Driver: "sqlite", SQLitePath: ":memory:"}
	first, release, err := m.acquire(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	db := first.sql
	if _, err = db.Exec("CREATE TABLE demo (value TEXT)"); err != nil {
		t.Fatal(err)
	}
	release()
	second, release, err := m.acquire(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if second.sql != db {
		t.Fatal("opened a new client for the second query")
	}
	if _, err = second.sql.Exec("INSERT INTO demo VALUES ('retained')"); err != nil {
		t.Fatal(err)
	}
	release()
	if m.status("test").State != "connected" {
		t.Fatal("missing connected status")
	}
	m.disconnect("test")
	if m.status("test").State != "disconnected" {
		t.Fatal("missing disconnected status")
	}
	if db.Ping() == nil {
		t.Fatal("disconnect did not close client")
	}
}

func TestManagerBackoffAndCredentialErrorsAreSafe(t *testing.T) {
	m := newConnectionManager()
	defer m.Close()
	cfg := dbConnectionRequest{ID: "invalid", Driver: "postgres", DSN: "postgres://user:do-not-leak@127.0.0.1:1/app"}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, _, err := m.acquire(ctx, cfg)
	if err == nil {
		t.Fatal("expected connection failure")
	}
	h := m.entry("invalid")
	h.mu.Lock()
	retry := h.retry
	h.mu.Unlock()
	if retry.Before(time.Now()) {
		t.Fatal("no backoff")
	}
	_, _, err = m.acquire(ctx, cfg)
	if err == nil {
		t.Fatal("must respect backoff")
	}
	if m.status("invalid").Error != "Database connection failed. Check credentials, address and server availability." {
		t.Fatal("unsafe error")
	}
}

func TestManagerIdleAndReconnect(t *testing.T) {
	m := newConnectionManager()
	defer m.Close()
	cfg := dbConnectionRequest{ID: "lifecycle", Driver: "sqlite", SQLitePath: ":memory:", IdleTimeoutMinutes: 1}
	h, release, err := m.acquire(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	h.close()
	h.fail(context.DeadlineExceeded)
	h.retry = time.Now().Add(-time.Second)
	release()
	m.maintain(time.Now())
	if m.status(cfg.ID).State != "connected" {
		t.Fatal("did not reconnect after backoff")
	}
	h.mu.Lock()
	h.used = time.Now().Add(-2 * time.Minute)
	h.mu.Unlock()
	m.maintain(time.Now())
	if m.status(cfg.ID).State != "disconnected" {
		t.Fatal("idle connection was not closed")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sql != nil || h.wanted {
		t.Fatal("idle close left an active client or reconnect intent")
	}
}

func TestUnusedVaultVariableDoesNotBlockLocalCredentials(t *testing.T) {
	cfg, err := resolveCredentials(dbConnectionRequest{Host: "{{ host }}", Password: "local-password", Variables: `{"host":"127.0.0.1","unused":"vault:locked"}`})
	if err != nil {
		t.Fatalf("unused Vault variable blocked the connection: %v", err)
	}
	if cfg.Host != "127.0.0.1" {
		t.Fatal("connection variable with whitespace was not substituted")
	}
}
