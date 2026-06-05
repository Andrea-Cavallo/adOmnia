package mock

import (
	"net/http/httptest"
	"testing"
)

func TestMatchesAllConditionsQuery(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/users?role=admin", nil)
	resp := mockResponse{
		Conditions: []mockCondition{{
			Source:   "query",
			Field:    "role",
			Operator: "eq",
			Value:    "admin",
		}},
	}

	if !matchesAllConditions(req, resp, nil, nil) {
		t.Fatal("expected query condition to match")
	}
}

func TestMatchesAllConditionsBodyJSONPath(t *testing.T) {
	req := httptest.NewRequest("POST", "/v1/users", nil)
	resp := mockResponse{
		Conditions: []mockCondition{{
			Source:   "body_jsonpath",
			Field:    ".user.role",
			Operator: "contains",
			Value:    "admin",
		}},
	}

	if !matchesAllConditions(req, resp, nil, []byte(`{"user":{"role":"super-admin"}}`)) {
		t.Fatal("expected JSONPath condition to match")
	}
}

func TestPickResponseForRequestUsesFallback(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/users/123?role=user", nil)
	params, ok := matchPathParams("/v1/users/:id", "/v1/users/123")
	if !ok {
		t.Fatal("expected route to match")
	}

	ep := mockEndpoint{
		Responses: []mockResponse{
			{
				ID:       "admin",
				IsActive: true,
				Conditions: []mockCondition{{
					Source:   "query",
					Field:    "role",
					Operator: "eq",
					Value:    "admin",
				}},
			},
			{
				ID:       "fallback",
				IsActive: true,
			},
		},
	}

	resp, conditional := pickResponseForRequest(&ep, req, params, nil)
	if !conditional {
		t.Fatal("expected conditional matching mode")
	}
	if resp == nil || resp.ID != "fallback" {
		t.Fatalf("expected fallback response, got %#v", resp)
	}
}

func TestPathParamCondition(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/users/123", nil)
	params, ok := matchPathParams("/v1/users/:id", "/v1/users/123")
	if !ok {
		t.Fatal("expected route to match")
	}

	resp := mockResponse{
		Conditions: []mockCondition{{
			Source:   "path_param",
			Field:    "id",
			Operator: "eq",
			Value:    "123",
		}},
	}

	if !matchesAllConditions(req, resp, params, nil) {
		t.Fatal("expected path param condition to match")
	}
}
