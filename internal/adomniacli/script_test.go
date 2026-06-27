package adomniacli

import (
	"testing"
	"time"

	"adomnia/internal/httpexec"
)

func TestRunHeadlessScriptMutatesVariablesAndEvaluatesTests(t *testing.T) {
	vars := map[string]string{}
	if _, err := runHeadlessScript(`pm.environment.set('token', 'abc')`, vars, nil); err != nil {
		t.Fatal(err)
	}
	if vars["token"] != "abc" {
		t.Fatalf("vars = %#v", vars)
	}
	response := &httpexec.HTTPExecResponse{Status: 200, Body: `{"email":"a@example.test"}`}
	if _, err := runHeadlessScript(`pm.test('status', () => { pm.expect(pm.response.code).to.equal(200); }); pm.test('email', () => { pm.expect(pm.response.json().email).to.exist; });`, vars, response); err != nil {
		t.Fatal(err)
	}
	if _, err := runHeadlessScript(`pm.test('status', () => { pm.expect(pm.response.code).to.equal(201); });`, vars, response); err == nil {
		t.Fatal("expected failed script test")
	}
}

func TestRunHeadlessScriptTimesOut(t *testing.T) {
	started := time.Now()
	if _, err := runHeadlessScript(`while (true) {}`, map[string]string{}, nil); err == nil || time.Since(started) > 3*time.Second {
		t.Fatalf("err = %v, duration = %v", err, time.Since(started))
	}
}
