package agentcontrol

import (
	"context"
	"encoding/json/v2"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/aipolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agentreview"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/workspace"
)

func TestBridgeAuthenticationAndDiscovery(t *testing.T) {
	dir := t.TempDir()
	calls := 0
	server, err := Start(dir, func(ctx context.Context, request Request) (any, error) {
		calls++
		return map[string]string{"operation": request.Operation}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	for _, test := range []struct{ token, origin string }{{"", ""}, {server.endpoint.Token, "https://example.com"}} {
		request, _ := http.NewRequest("POST", server.endpoint.Address+"/call", strings.NewReader(`{"project":"x","operation":"ide_status"}`))
		request.Header.Set("Authorization", "Bearer "+test.token)
		request.Header.Set("Origin", test.origin)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("status %d", response.StatusCode)
		}
	}
	if calls != 0 {
		t.Fatal("unauthorized handler invocation")
	}
	result, err := Call(context.Background(), dir, Request{Project: "x", Operation: "ide_status"})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result)
	if !strings.Contains(string(encoded), "ide_status") {
		t.Fatal(string(encoded))
	}
}
func TestRouterProjectPolicyAndSessionIsolation(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	authorized := false
	router := &Router{Sessions: func() ([]workspace.Session, error) {
		state := workspace.AuthorizationOpened
		if authorized {
			state = workspace.AuthorizationPermitted
		}
		return []workspace.Session{{ID: "owned", Project: workspace.Project{RealPath: root, Authorization: state}}}, nil
	}, Operations: map[string]Operation{"test": func(ctx context.Context, session string, args map[string]any) (any, error) {
		return args["sessionId"], nil
	}}}
	request := Request{Project: other, Operation: "test", Arguments: map[string]any{"sessionId": "foreign"}}
	if _, err := router.Handle(context.Background(), request); err == nil {
		t.Fatal("foreign project accepted")
	}
	request.Project = root
	if _, err := router.Handle(context.Background(), request); err == nil {
		t.Fatal("untrusted project accepted")
	}
	authorized = true
	result, err := router.Handle(context.Background(), request)
	if err != nil || result != "owned" {
		t.Fatalf("session override: %v %v", result, err)
	}
	if err := aipolicy.Save(root, aipolicy.Off); err != nil {
		t.Fatal(err)
	}
	request.Operation = "ide_status"
	if _, err := router.Handle(context.Background(), request); err == nil {
		t.Fatal("AI off was ignored")
	}
	if err := aipolicy.Save(root, aipolicy.LocalOnly); err != nil {
		t.Fatal(err)
	}
	if _, err := router.Handle(context.Background(), request); err == nil {
		t.Fatal("cloud access to local-only")
	}
	request.Arguments["localProvider"] = true
	if _, err := router.Handle(context.Background(), request); err != nil {
		t.Fatal(err)
	}
}
func TestExternalReviewLifecycleAndBoundedLogs(t *testing.T) {
	root := t.TempDir()
	router := &Router{Sessions: func() ([]workspace.Session, error) {
		return []workspace.Session{{ID: "session", Project: workspace.Project{RealPath: root, Authorization: workspace.AuthorizationPermitted}}}, nil
	}, Operations: map[string]Operation{}}
	RegisterReview(router, agentreview.NewTracker())
	request := Request{Project: root, Operation: "ide_review_begin"}
	if _, err := router.Handle(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if _, err := router.Handle(context.Background(), request); err == nil {
		t.Fatal("overlapping turn accepted")
	}
	request.Operation = "ide_review_end"
	if _, err := router.Handle(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if _, err := router.Handle(context.Background(), request); err == nil {
		t.Fatal("ended an absent turn")
	}
	for i := range 110 {
		router.Record("session", i)
	}
	request.Operation = "ide_logs"
	logs, err := router.Handle(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if rows := logs.([]any); len(rows) != 100 || rows[0] != 10 {
		t.Fatalf("unbounded logs %v", rows)
	}
}
