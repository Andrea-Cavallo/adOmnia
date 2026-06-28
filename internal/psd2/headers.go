package psd2

import (
	"crypto/rand"
	"fmt"
	"regexp"
	"strings"
)

var uuidV4Pattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type BerlinHeaderBuilder struct{}

func (BerlinHeaderBuilder) Build(input HeaderBuildInput) (HeaderBuildResult, error) {
	required, conditional, err := operationHeaders(input.Operation)
	if err != nil {
		return HeaderBuildResult{}, err
	}
	headers := cloneHeaders(input.Headers)
	if headerValue(headers, HeaderRequestID) == "" {
		headers[HeaderRequestID] = newUUIDv4()
	}
	missing := missingHeaders(headers, required)
	return HeaderBuildResult{Headers: headers, Required: required, Conditional: conditional, Missing: missing}, nil
}

func (BerlinHeaderBuilder) Validate(input HeaderBuildInput) error {
	result, err := (BerlinHeaderBuilder{}).Build(input)
	if err != nil {
		return err
	}
	if len(result.Missing) > 0 {
		return fmt.Errorf("missing required PSD2 headers: %s", strings.Join(result.Missing, ", "))
	}
	if !uuidV4Pattern.MatchString(headerValue(result.Headers, HeaderRequestID)) {
		return fmt.Errorf("%s must be a UUID v4", HeaderRequestID)
	}
	return nil
}

func operationHeaders(operation string) ([]string, []string, error) {
	switch operation {
	case OperationAISConsent:
		return []string{HeaderRequestID, HeaderContentType, HeaderPSUIP}, []string{"TPP-Redirect-URI", "TPP-Nok-Redirect-URI"}, nil
	case OperationPISPayment:
		return []string{HeaderRequestID, HeaderContentType, HeaderPSUIP}, []string{"TPP-Redirect-URI", "TPP-Nok-Redirect-URI"}, nil
	case OperationFCSConfirmation:
		return []string{HeaderRequestID, HeaderContentType}, []string{HeaderPSUIP, HeaderConsentID}, nil
	default:
		return nil, nil, fmt.Errorf("unsupported PSD2 operation %q", operation)
	}
}

func cloneHeaders(source map[string]string) map[string]string {
	out := make(map[string]string, len(source)+1)
	for k, v := range source {
		out[k] = v
	}
	return out
}
func missingHeaders(headers map[string]string, required []string) []string {
	var out []string
	for _, name := range required {
		if strings.TrimSpace(headerValue(headers, name)) == "" {
			out = append(out, name)
		}
	}
	return out
}
func newUUIDv4() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
