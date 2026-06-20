package main

import "adomnia/internal/pdfsign"

func (a *App) SignPdfDocumentBase64(reqJSON string) (string, error) {
	return pdfsign.Sign(reqJSON)
}

func (a *App) VerifyPdfSignatureBase64(pdfBase64 string) (string, error) {
	return pdfsign.Verify(pdfBase64)
}

func (a *App) InspectSigningCertificateBase64(reqJSON string) (string, error) {
	return pdfsign.InspectCertificate(reqJSON)
}
