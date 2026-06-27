package oascontract

import (
	"strings"
	"testing"

	"adomnia/internal/httpexec"
	"adomnia/internal/requestcontract"
)

func TestValidateResponseContract(t *testing.T) {
	validator, err := New(`
openapi: 3.1.0
paths:
  /users/{id}:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [email]
                properties:
                  email:
                    type: string
`)
	if err != nil {
		t.Fatal(err)
	}
	req := requestcontract.Request{Method: "GET", OpenAPIPath: "/users/{id}"}
	valid := httpexec.HTTPExecResponse{Status: 200, ContentType: "application/json; charset=utf-8", Body: `{"email":"a@example.test"}`}
	if message := validator.Validate(req, valid); message != "" {
		t.Fatalf("valid response: %s", message)
	}
	invalid := valid
	invalid.Body = `{"id":1}`
	if message := validator.Validate(req, invalid); !strings.Contains(message, "$.email is required") {
		t.Fatalf("message = %q", message)
	}
	invalidStatus := valid
	invalidStatus.Status = 404
	if message := validator.Validate(req, invalidStatus); !strings.Contains(message, "status 404") {
		t.Fatalf("message = %q", message)
	}
}
