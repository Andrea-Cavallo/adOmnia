package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateOrder(t *testing.T) {
	api := handler()
	response := httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/orders", strings.NewReader(`{"customerId":"usr_1001","items":[{"sku":"coffee-001","quantity":2}]}`)))
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	list := httptest.NewRecorder()
	api.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/orders", nil))
	if !strings.Contains(list.Body.String(), `"count":2`) {
		t.Fatal(list.Body.String())
	}
}
