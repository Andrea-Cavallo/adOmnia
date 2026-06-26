package nettools

import "testing"

func find(entries []PortEntry, port int) (PortEntry, bool) {
	for _, e := range entries {
		if e.Port == port {
			return e, true
		}
	}
	return PortEntry{}, false
}

func TestParseNetstatWindows(t *testing.T) {
	out := `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1240
  TCP    [::]:445               [::]:0                 LISTENING       4
  TCP    127.0.0.1:50000        0.0.0.0:0              LISTENING       9876
  TCP    192.168.1.5:139        10.0.0.1:443          ESTABLISHED     2222
`
	names := map[int]string{1240: "svchost.exe", 4: "System", 9876: "adomnia.exe"}
	entries := parseNetstatWindows(out, names)
	if len(entries) != 3 {
		t.Fatalf("want 3 listening entries, got %d: %+v", len(entries), entries)
	}
	if e, ok := find(entries, 50000); !ok || e.PID != 9876 || e.Process != "adomnia.exe" || e.Address != "127.0.0.1" {
		t.Errorf("port 50000 entry wrong: %+v", e)
	}
	if _, ok := find(entries, 139); ok {
		t.Error("ESTABLISHED connection should be excluded")
	}
}

func TestParseSS(t *testing.T) {
	out := `LISTEN 0      4096         0.0.0.0:8080       0.0.0.0:*    users:(("adomnia",pid=4321,fd=7))
LISTEN 0      128             [::]:22            [::]:*
LISTEN 0      511        127.0.0.1:6379       0.0.0.0:*    users:(("redis-server",pid=900,fd=6))`
	entries := parseSS(out)
	if len(entries) != 3 {
		t.Fatalf("want 3, got %d: %+v", len(entries), entries)
	}
	if e, _ := find(entries, 8080); e.Process != "adomnia" || e.PID != 4321 {
		t.Errorf("8080 wrong: %+v", e)
	}
	if e, _ := find(entries, 22); e.Address != "::" {
		t.Errorf("22 address wrong: %+v", e)
	}
}

func TestParseLsof(t *testing.T) {
	out := `COMMAND     PID   USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME
node      1234 andrea   23u  IPv4 0x111      0t0  TCP *:3000 (LISTEN)
redis-ser  567 andrea    8u  IPv6 0x222      0t0  TCP [::1]:6379 (LISTEN)
Chrome     999 andrea   45u  IPv4 0x333      0t0  TCP 127.0.0.1:5173->127.0.0.1:1 (ESTABLISHED)`
	entries := parseLsof(out)
	if len(entries) != 2 {
		t.Fatalf("want 2 listening, got %d: %+v", len(entries), entries)
	}
	if e, _ := find(entries, 3000); e.Process != "node" || e.PID != 1234 || e.Address != "*" {
		t.Errorf("3000 wrong: %+v", e)
	}
	if e, _ := find(entries, 6379); e.Address != "::1" {
		t.Errorf("6379 address wrong: %+v", e)
	}
}
