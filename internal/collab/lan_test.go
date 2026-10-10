package collab

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// TestLANAcceptance è il collaudo più vicino alla prova "due computer" che si
// possa eseguire su una sola macchina: apre il listener sull'indirizzo IPv4
// LAN reale (non loopback), vi si connette con un secondo Manager attraverso
// quell'indirizzo e verifica TLS pinning + invito monouso + condivisione
// redatta. Viene saltato se la macchina non ha interfacce LAN (o nessuna
// riesce ad aprire la porta, es. firewall locale).
func TestLANAcceptance(t *testing.T) {
	addrs := LocalAddresses()
	if len(addrs) == 0 {
		t.Skip("nessuna interfaccia IPv4 LAN disponibile su questo host")
	}

	for _, ip := range addrs {
		host := NewManager(nil)
		status, err := host.Host(ip, 0, "Alice")
		if err != nil {
			host.Stop()
			t.Logf("bind su %s fallito (%v): provo il prossimo", ip, err)
			continue
		}
		if !strings.Contains(status.Address, ip) {
			host.Stop()
			t.Fatalf("l'host deve ascoltare sull'IP scelto %s, non su %s", ip, status.Address)
		}

		inv, err := host.CreateInvite(RoleEditor, time.Minute)
		if err != nil {
			host.Stop()
			t.Fatal(err)
		}

		rec := &recorder{}
		guest := NewManager(rec.emit)
		if _, err := guest.Join(inv.Code, "Bob"); err != nil {
			host.Stop()
			t.Fatalf("join via LAN %s fallito: %v", ip, err)
		}

		data := json.RawMessage(`{"name":"Payments","headers":[{"key":"Authorization","value":"Bearer secret-token"}],"variables":[{"key":"base","value":"http://10.0.0.5"}]}`)
		if _, err := host.Share(ShareCollection, "Payments", data); err != nil {
			host.Stop()
			guest.Stop()
			t.Fatal(err)
		}

		got := rec.waitFor(t, EventShare)
		var share Share
		if err := json.Unmarshal(got.Payload, &share); err != nil {
			host.Stop()
			guest.Stop()
			t.Fatal(err)
		}
		body := string(share.Data)
		if strings.Contains(body, "secret-token") {
			host.Stop()
			guest.Stop()
			t.Fatalf("segreto trapelato sulla LAN: %s", body)
		}
		if !strings.Contains(body, "http://10.0.0.5") {
			host.Stop()
			guest.Stop()
			t.Fatalf("dato non segreto assente: %s", body)
		}

		guest.Stop()
		host.Stop()
		return
	}

	t.Skip("nessun indirizzo LAN disponibile per aprire il listener")
}
