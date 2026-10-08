package collab

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

const inviteScheme = "adomnia-collab"

type parsedInvite struct {
	Address     string
	Token       string
	Fingerprint string
}

func formatInvite(address, token, fp string) string {
	q := url.Values{"t": {token}, "fp": {fp}}
	return (&url.URL{Scheme: inviteScheme, Host: address, RawQuery: q.Encode()}).String()
}

func parseInvite(code string) (parsedInvite, error) {
	u, err := url.Parse(strings.TrimSpace(code))
	if err != nil || u.Scheme != inviteScheme {
		return parsedInvite{}, errors.New("codice di invito non valido")
	}
	if _, _, err := net.SplitHostPort(u.Host); err != nil {
		return parsedInvite{}, fmt.Errorf("indirizzo dell'host non valido: %w", err)
	}
	inv := parsedInvite{Address: u.Host, Token: u.Query().Get("t"), Fingerprint: strings.ToLower(u.Query().Get("fp"))}
	if len(inv.Token) != 64 || len(inv.Fingerprint) != 64 {
		return parsedInvite{}, errors.New("codice di invito incompleto")
	}
	return inv, nil
}

// LocalAddresses elenca gli IPv4 non-loopback su cui l'host può ascoltare.
func LocalAddresses() []string {
	var out []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok && ipnet.IP.To4() != nil {
				out = append(out, ipnet.IP.String())
			}
		}
	}
	return out
}
