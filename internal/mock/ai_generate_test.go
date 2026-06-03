package mock

import (
	"strings"
	"testing"
)

func TestParseAIResponse_PlainArray(t *testing.T) {
	in := `[{"path":"/users","method":"GET","statusCode":200,"headers":{"Content-Type":"application/json"},"body":"[]","delayMs":0}]`
	eps, err := ParseAIResponse(in)
	if err != nil {
		t.Fatalf("ParseAIResponse: %v", err)
	}
	if len(eps) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", len(eps))
	}
	if eps[0].Path != "/users" || eps[0].Method != "GET" || eps[0].StatusCode != 200 {
		t.Fatalf("unexpected endpoint: %+v", eps[0])
	}
}

func TestParseAIResponse_WrappedInProse(t *testing.T) {
	// Models often wrap the JSON in explanatory text or code fences; the
	// parser must extract the array from the surrounding noise.
	in := "Here are the endpoints:\n```json\n[{\"path\":\"/a\",\"method\":\"POST\",\"statusCode\":201}]\n```\nDone."
	eps, err := ParseAIResponse(in)
	if err != nil {
		t.Fatalf("ParseAIResponse with prose: %v", err)
	}
	if len(eps) != 1 || eps[0].Method != "POST" {
		t.Fatalf("unexpected parse result: %+v", eps)
	}
}

func TestParseAIResponse_NoArray(t *testing.T) {
	if _, err := ParseAIResponse("I cannot help with that."); err == nil {
		t.Fatalf("expected error when no JSON array present")
	}
}

func TestParseAIResponse_InvalidJSON(t *testing.T) {
	if _, err := ParseAIResponse("[ {not valid json} ]"); err == nil {
		t.Fatalf("expected error for malformed JSON array")
	}
}

func TestBuildMockGenerationPrompt_IncludesInputAndSchema(t *testing.T) {
	for _, typ := range []string{"natural", "json", "openapi"} {
		prompt := BuildMockGenerationPrompt(typ, "MY_INPUT_MARKER")
		if !strings.Contains(prompt, "MY_INPUT_MARKER") {
			t.Errorf("[%s] prompt missing user input", typ)
		}
		if !strings.Contains(prompt, "statusCode") {
			t.Errorf("[%s] prompt missing JSON schema hint", typ)
		}
	}
}
