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
