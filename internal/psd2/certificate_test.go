package psd2

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestInspectPEMExtractsPSD2Identity(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	infoRaw, err := asn1.Marshal(psd2QCType{Roles: []roleOfPSP{{OID: asn1.ObjectIdentifier{0, 4, 0, 19495, 1, 2}, Name: "PSP_PI"}, {OID: asn1.ObjectIdentifier{0, 4, 0, 19495, 1, 3}, Name: "PSP_AI"}}, NCAName: "Banca d'Italia", NCAID: "IT-BOI"})
	if err != nil {
		t.Fatal(err)
	}
	statementsRaw, err := asn1.Marshal([]qcStatement{{ID: oidPSD2QCStatement, Info: asn1.RawValue{FullBytes: infoRaw}}})
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(7), Subject: pkix.Name{CommonName: "TPP", ExtraNames: []pkix.AttributeTypeAndValue{{Type: oidOrganizationIdentifier, Value: "PSD2-IT-BOI-12345"}}}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), ExtraExtensions: []pkix.Extension{{Id: oidQCStatements, Value: statementsRaw}}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "qseal.pem")
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := (FileCertificateManager{}).Inspect(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if info.OrganizationIdentifier != "PSD2-IT-BOI-12345" {
		t.Fatalf("organizationIdentifier: %q", info.OrganizationIdentifier)
	}
	if len(info.PSPRoles) != 2 || info.PSPRoles[0] != "PSP_PI" || info.PSPRoles[1] != "PSP_AI" {
		t.Fatalf("roles: %v", info.PSPRoles)
	}
	if info.NCAName != "Banca d'Italia" || info.NCAID != "IT-BOI" {
		t.Fatalf("NCA: %q %q", info.NCAName, info.NCAID)
	}
	if info.HasPrivateKey {
		t.Fatal("certificate-only PEM must not report a private key")
	}
}
