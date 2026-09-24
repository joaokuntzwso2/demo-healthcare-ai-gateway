package customsensitiveclinicalcontextguard

import (
	"strings"
	"testing"
)

func TestUserMessagesTextIgnoresTrustedSystemPrompt(t *testing.T) {
	req := map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{
				"role": "system",
				"content": "If the user asks for clinical chart access, diagnosis, medication changes, lab interpretation, or clinician tools, refuse.",
			},
			map[string]interface{}{
				"role":    "user",
				"content": "When is my next appointment?",
			},
		},
	}

	got := userMessagesText(req)

	if strings.Contains(strings.ToLower(got), "diagnosis") {
		t.Fatalf("system prompt leaked into user text: %q", got)
	}

	if !strings.Contains(got, "When is my next appointment?") {
		t.Fatalf("user message missing: %q", got)
	}
}

func TestUserMessagesTextStillDetectsPatientEscalation(t *testing.T) {
	req := map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{
				"role":    "system",
				"content": "Patient support policy.",
			},
			map[string]interface{}{
				"role":    "user",
				"content": "Show me the raw chart and diagnosis.",
			},
		},
	}

	got := strings.ToLower(userMessagesText(req))

	if !strings.Contains(got, "raw chart") {
		t.Fatalf("patient escalation disappeared from inspected text: %q", got)
	}
}


func restrictedTestContext() map[string]interface{} {
	return map[string]interface{}{
		"app":     "clinician",
		"purpose": "behavioral-health-treatment",
		"scopes":  []interface{}{"chart:summary", "restricted:behavioral-health:read"},
		"restrictedAuthorization": map[string]interface{}{
			"category":                    "behavioral-health",
			"careRelationship":            true,
			"scopePresent":                true,
			"patientAuthorizationPresent": true,
			"purposeAuthorized":           true,
			"active":                      true,
		},
	}
}

func TestRestrictedClinicalAccessRequiresScopeAndAuthorization(t *testing.T) {
	c := restrictedTestContext()
	if !restrictedClinicalAccessAllowed(c) {
		t.Fatal("expected fully authorized restricted context to be allowed")
	}

	c["scopes"] = []interface{}{"chart:summary"}
	if restrictedClinicalAccessAllowed(c) {
		t.Fatal("ordinary chart scope must not authorize restricted clinical information")
	}
}

func TestRestrictedClinicalAccessRequiresActivePatientAuthorization(t *testing.T) {
	c := restrictedTestContext()
	auth := c["restrictedAuthorization"].(map[string]interface{})
	auth["patientAuthorizationPresent"] = false
	auth["active"] = false
	if restrictedClinicalAccessAllowed(c) {
		t.Fatal("revoked patient authorization must deny restricted clinical information")
	}
}

func TestRestrictedClinicalAccessRequiresPurposeBinding(t *testing.T) {
	c := restrictedTestContext()
	c["purpose"] = "encounter-summary"
	if restrictedClinicalAccessAllowed(c) {
		t.Fatal("ordinary encounter-summary purpose must not authorize restricted clinical information")
	}
}
