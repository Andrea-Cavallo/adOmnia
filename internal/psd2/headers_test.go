package psd2

import "testing"

func TestHeaderBuilderGeneratesUUIDAndDoesNotMutateInput(t *testing.T) {
	original := map[string]string{HeaderContentType: "application/json", HeaderPSUIP: "127.0.0.1"}
	result, err := (BerlinHeaderBuilder{}).Build(HeaderBuildInput{Operation: OperationAISConsent, Headers: original})
	if err != nil {
		t.Fatal(err)
	}
	if original[HeaderRequestID] != "" {
		t.Fatal("builder mutated input")
	}
	if !uuidV4Pattern.MatchString(result.Headers[HeaderRequestID]) {
		t.Fatalf("invalid UUID v4: %q", result.Headers[HeaderRequestID])
	}
	if len(result.Missing) != 0 {
		t.Fatalf("unexpected missing headers: %v", result.Missing)
	}
}

func TestHeaderBuilderFailsFast(t *testing.T) {
	err := (BerlinHeaderBuilder{}).Validate(HeaderBuildInput{Operation: OperationPISPayment, Headers: map[string]string{HeaderRequestID: "bad"}})
	if err == nil {
		t.Fatal("expected validation error")
	}
}
