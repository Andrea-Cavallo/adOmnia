package milk

import (
	"context"
	"strings"
	"testing"

	jsonv1 "encoding/json"
)

func permissionRequest(kind string) jsonv1.RawMessage {
	return jsonv1.RawMessage(`{"sessionId":"s","toolCall":{"toolCallId":"t","title":"Run go test","kind":"` + kind + `"},"options":[{"optionId":"yes","name":"Allow","kind":"allow_once"},{"optionId":"no","name":"Deny","kind":"reject_once"}]}`)
}

func TestPermissionRulesDecideWithoutAskingAndRecordTheDecision(t *testing.T) {
	manager := NewManager(NewSettingsStore(t.TempDir()))
	var autos []AutoPermissionEvent
	manager.SetEmitter(func(event string, payload any) {
		if strings.HasSuffix(event, ".permissionAuto") {
			autos = append(autos, payload.(AutoPermissionEvent))
		}
	})
	manager.settings.PermissionRules = map[string]string{PermissionShell: RuleDeny, PermissionRead: RuleAllow}
	manager.settings.SkipPermissions = true // a deny rule still wins
	h := &handler{manager: manager}

	denied, err := h.HandleRequest(context.Background(), "session/request_permission", permissionRequest("execute"))
	if err != nil || !strings.Contains(jsonString(t, denied), `"no"`) {
		t.Fatalf("shell must be denied by rule: %v %v", jsonString(t, denied), err)
	}
	allowed, err := h.HandleRequest(context.Background(), "session/request_permission", permissionRequest("read"))
	if err != nil || !strings.Contains(jsonString(t, allowed), `"yes"`) {
		t.Fatalf("read must be allowed by rule: %v %v", jsonString(t, allowed), err)
	}
	if len(autos) != 2 || autos[0].Category != PermissionShell || autos[0].Outcome != "denied" || autos[1].Outcome != "allowed" {
		t.Fatalf("decisions not recorded: %+v", autos)
	}
}

func TestPermissionRulesAreValidated(t *testing.T) {
	if _, err := (Settings{PermissionRules: map[string]string{"publish": RuleAllow}}).Validate(); err == nil {
		t.Fatal("unknown category accepted")
	}
	if _, err := (Settings{PermissionRules: map[string]string{PermissionWrite: "maybe"}}).Validate(); err == nil {
		t.Fatal("unknown rule accepted")
	}
	clean, err := (Settings{PermissionRules: map[string]string{PermissionWrite: RuleAsk, PermissionShell: RuleDeny}}).Validate()
	if err != nil || len(clean.PermissionRules) != 1 {
		t.Fatalf("ask is the default and is not stored: %+v %v", clean.PermissionRules, err)
	}
}

func jsonString(t *testing.T, value any) string {
	t.Helper()
	data, err := jsonv1.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
