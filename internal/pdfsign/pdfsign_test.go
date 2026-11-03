package pdfsign

import (
	"bytes"
	"encoding/base64"
	"encoding/json/v2"
	"encoding/pem"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"crypto/x509"
)

// minimalPDF builds a one-page PDF with a correct cross-reference table.
func minimalPDF() []byte {
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>",
		"<< /Length 0 >>\nstream\n\nendstream",
	}
	var out bytes.Buffer
	out.WriteString("%PDF-1.7\n")
	offsets := make([]int, len(objects))
	for i, object := range objects {
		offsets[i] = out.Len()
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&out, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return out.Bytes()
}

func signingRequest(t *testing.T, visible bool, appearance []byte) string {
	t.Helper()
	key, _, der := testKeyAndCert(t)
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	request := Request{
		PdfBase64:      base64.StdEncoding.EncodeToString(minimalPDF()),
		CertificatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})),
		PrivateKeyPEM:  string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})),
		Name:           "Andrea Tester", Location: "Torino", Reason: "Approval", ContactInfo: "test@example.com",
		Visible: visible, Page: 1, X: 40, Y: 40,
	}
	if appearance != nil {
		request.AppearanceBase64 = base64.StdEncoding.EncodeToString(appearance)
	}
	data, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func pngImage(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 2))
	img.Set(1, 1, color.RGBA{R: 200, A: 255})
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

type verification struct {
	Error   string
	Signers []struct {
		Name           string `json:"name"`
		Reason         string `json:"reason"`
		Location       string `json:"location"`
		ContactInfo    string `json:"contact_info"`
		ValidSignature bool   `json:"valid_signature"`
		TrustedIssuer  bool   `json:"trusted_issuer"`
	}
}

// TestSignThenVerifyRoundTrip signs a PDF the way the PDF editor does (invisible,
// visible with the default text, visible with an image) and verifies it: the
// signature must be valid and keep name, reason, location and contact. The
// self-signed test certificate is not trusted, which the report must say.
func TestSignThenVerifyRoundTrip(t *testing.T) {
	cases := []struct {
		name       string
		visible    bool
		appearance []byte
	}{
		{"invisible", false, nil},
		{"visible text", true, nil},
		{"visible image", true, pngImage(t)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			signedJSON, err := Sign(signingRequest(t, tc.visible, tc.appearance))
			if err != nil {
				t.Fatal(err)
			}
			var signed signatureResult
			if err := json.Unmarshal([]byte(signedJSON), &signed); err != nil {
				t.Fatal(err)
			}
			pdfBytes, err := base64.StdEncoding.DecodeString(signed.PdfBase64)
			if err != nil || signed.Size != len(pdfBytes) || !bytes.HasPrefix(pdfBytes, minimalPDF()) {
				t.Fatalf("signed output must be an incremental update of the input: size=%d err=%v", signed.Size, err)
			}
			if tc.visible != strings.Contains(string(pdfBytes), "/AP") {
				t.Fatalf("visible=%v but appearance stream present=%v", tc.visible, !tc.visible)
			}
			reportJSON, err := Verify(signed.PdfBase64)
			if err != nil {
				t.Fatal(err)
			}
			var report verification
			if err := json.Unmarshal([]byte(reportJSON), &report); err != nil {
				t.Fatal(err)
			}
			if len(report.Signers) != 1 {
				t.Fatalf("report = %s", reportJSON)
			}
			signer := report.Signers[0]
			if !signer.ValidSignature || signer.Name != "Andrea Tester" || signer.Reason != "Approval" || signer.Location != "Torino" || signer.ContactInfo != "test@example.com" {
				t.Fatalf("signer = %+v", signer)
			}
			if signer.TrustedIssuer || report.Error == "" {
				t.Fatalf("a self-signed certificate must not be reported as trusted: %s", reportJSON)
			}
		})
	}
}

func TestVerifyRejectsAnUnsignedPDF(t *testing.T) {
	if _, err := Verify(base64.StdEncoding.EncodeToString(minimalPDF())); err == nil {
		t.Fatal("an unsigned PDF has no signature to verify")
	}
}
