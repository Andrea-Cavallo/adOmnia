package main

import "github.com/Andrea-Cavallo/adOmnia/internal/nettools"

func (g *GoIDE) ReadProjectKeystore(sessionID, path string) (string, error) {
	return g.service.ReadProjectKeystore(sessionID, path)
}

// InspectCertificate legge i blocchi PEM del testo aperto nell'editor: certificati con i loro dettagli,
// chiavi private solo come tipo, bit e cifratura. Il testo arriva dal buffer, nessun accesso al disco.
func (g *GoIDE) InspectCertificate(text string) ([]nettools.CertificateInfo, error) {
	return nettools.InspectPEM(text)
}
