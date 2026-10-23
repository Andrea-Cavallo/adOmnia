package proxy

import (
	"net"
	"net/http"
	"net/url"
	"strconv"
)

// forwardError è il rifiuto di una destinazione, con lo status HTTP da restituire al client.
type forwardError struct {
	message string
	status  int
}

func (e *forwardError) Error() string { return e.message }

// forwardTargetError controlla la destinazione che l'interceptor sta per contattare. Il proxy inoltra per
// costruzione ciò che il client intercettato chiede, quindi non c'è una lista di host consentiti: i due controlli
// sono quelli che non hanno senso per nessun client, cioè schemi diversi da http/https (file:, gopher:, ftp:…) e
// una richiesta verso la porta del proxy stesso su un indirizzo locale, che farebbe girare la richiesta in tondo.
func forwardTargetError(targetURL string, ownPort int) *forwardError {
	target, err := url.Parse(targetURL)
	if err != nil || target.Hostname() == "" {
		return &forwardError{message: "invalid request target", status: http.StatusBadGateway}
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return &forwardError{message: "only http and https targets are forwarded", status: http.StatusBadGateway}
	}
	if ownPort > 0 && portOf(target) == ownPort && isLocalHost(target.Hostname()) {
		return &forwardError{message: "request loops back to the interceptor", status: http.StatusLoopDetected}
	}
	return nil
}

func portOf(target *url.URL) int {
	if port := target.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil {
			return 0
		}
		return number
	}
	if target.Scheme == "https" {
		return 443
	}
	return 80
}

func isLocalHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsUnspecified())
}
