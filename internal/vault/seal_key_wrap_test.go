package vault

import (
	"bytes"
	"testing"
)

func TestWrapKeyFileRoundTrip(t *testing.T) {
	secret := bytes.Repeat([]byte{7}, 32)
	key := bytes.Repeat([]byte{42}, 32)
	wrapped := wrapKeyFile(key, secret)
	if bytes.Equal(wrapped, key) {
		t.Fatal("wrapped key file is still plaintext")
	}
	if !bytes.HasPrefix(wrapped, keyFileMagic) {
		t.Fatal("wrapped key file has no magic marker")
	}
	opened, err := unwrapKeyFile(wrapped, secret)
	if err != nil || !bytes.Equal(opened, key) {
		t.Fatalf("round trip = %x, %v", opened, err)
	}
}

func TestUnwrapKeyFileAcceptsLegacyPlaintext(t *testing.T) {
	key := bytes.Repeat([]byte{1}, 32)
	opened, err := unwrapKeyFile(key, nil)
	if err != nil || !bytes.Equal(opened, key) {
		t.Fatalf("legacy key = %x, %v", opened, err)
	}
	opened, err = unwrapKeyFile(key, bytes.Repeat([]byte{9}, 32))
	if err != nil || !bytes.Equal(opened, key) {
		t.Fatalf("legacy key with identity = %x, %v", opened, err)
	}
}

func TestUnwrapKeyFileRejectsWrongIdentity(t *testing.T) {
	wrapped := wrapKeyFile(bytes.Repeat([]byte{3}, 32), bytes.Repeat([]byte{7}, 32))
	if _, err := unwrapKeyFile(wrapped, bytes.Repeat([]byte{8}, 32)); err == nil {
		t.Fatal("a key wrapped for another machine must not open")
	}
	if _, err := unwrapKeyFile(wrapped, nil); err == nil {
		t.Fatal("a protected key must not open without an identity")
	}
}

func TestUnwrapKeyFileRejectsTampering(t *testing.T) {
	wrapped := wrapKeyFile(bytes.Repeat([]byte{3}, 32), bytes.Repeat([]byte{7}, 32))
	tampered := append([]byte(nil), wrapped...)
	tampered[len(tampered)-1] ^= 0xff
	if _, err := unwrapKeyFile(tampered, bytes.Repeat([]byte{7}, 32)); err == nil {
		t.Fatal("a modified key file must not open")
	}
	if _, err := unwrapKeyFile([]byte("ADK1short"), bytes.Repeat([]byte{7}, 32)); err == nil {
		t.Fatal("a truncated key file must not open")
	}
}

func TestWrapWithoutIdentityStaysPlaintext(t *testing.T) {
	key := bytes.Repeat([]byte{5}, 32)
	if wrapped := wrapKeyFile(key, nil); !bytes.Equal(wrapped, key) {
		t.Fatal("without a machine identity the key must stay as it is")
	}
}
