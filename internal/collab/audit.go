package collab

import "adomnia/internal/devlog"

// Audit deliberately records only operation and opaque identifiers. Invites,
// certificate fingerprints, shared bodies and user-provided titles never enter logs.
func audit(action, sessionID, participantID string, role Role, kind ShareKind) {
	devlog.Info("CollaborationAudit", action, map[string]any{
		"sessionId": sessionID, "participantId": participantID,
		"role": role, "kind": kind,
	})
}
