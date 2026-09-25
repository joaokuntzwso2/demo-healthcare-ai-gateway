package customtrustedclinicalsourceguard

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"testing"
)

func testKnowledgeProof(t *testing.T, sourceID, lifecycle, trust string, eligible bool) string {
	t.Helper()
	key := "knowledge-proof-test-key"
	t.Setenv("HELIOS_CONTEXT_SIGNING_KEY", key)
	payload := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%t",
		sourceID,
		"sha256-demo",
		"Helios Clinical Governance",
		"3.0",
		lifecycle,
		trust,
		eligible,
	)
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + hex.EncodeToString(mac.Sum(nil))
}

func TestActiveGovernedKnowledgePassesLifecycleCheck(t *testing.T) {
	proof := testKnowledgeProof(t, "src-v3", "ACTIVE", "TRUSTED_GOVERNED", true)
	text := fmt.Sprintf(`{"evidenceType":"CLINICAL KNOWLEDGE SOURCE","sourceId":"src-v3","lifecycleState":"ACTIVE","trustClassification":"TRUSTED_GOVERNED","eligibleForRetrieval":true,"signatureState":"valid-demo-hmac","knowledgeProof":"%s"}`, proof)
	code, _, details, blocked := knowledgeLifecycleFindingFromText(text)
	if blocked || code != "" {
		t.Fatalf("active governed knowledge should pass, blocked=%v code=%q", blocked, code)
	}
	if details["gatewayProofVerified"] != true {
		t.Fatalf("gateway proof should be verified: %#v", details)
	}
}

func TestStaleKnowledgeIsBlocked(t *testing.T) {
	proof := testKnowledgeProof(t, "src-v2", "STALE", "TRUSTED_GOVERNED", false)
	text := fmt.Sprintf(`{"evidenceType":"CLINICAL KNOWLEDGE SOURCE","sourceId":"src-v2","lifecycleState":"STALE","trustClassification":"TRUSTED_GOVERNED","eligibleForRetrieval":false,"signatureState":"valid-demo-hmac","knowledgeProof":"%s"}`, proof)
	code, _, _, blocked := knowledgeLifecycleFindingFromText(text)
	if !blocked || code != "CLINICAL_KNOWLEDGE_NOT_ACTIVE" {
		t.Fatalf("stale knowledge should be blocked, blocked=%v code=%q", blocked, code)
	}
}

func TestUntrustedKnowledgeIsBlocked(t *testing.T) {
	proof := testKnowledgeProof(t, "src-external", "QUARANTINED", "UNTRUSTED_EXTERNAL_EVIDENCE", false)
	text := fmt.Sprintf(`{"evidenceType":"CLINICAL KNOWLEDGE SOURCE","sourceId":"src-external","lifecycleState":"QUARANTINED","trustClassification":"UNTRUSTED_EXTERNAL_EVIDENCE","eligibleForRetrieval":false,"signatureState":"unsigned","knowledgeProof":"%s"}`, proof)
	code, _, _, blocked := knowledgeLifecycleFindingFromText(text)
	if !blocked || code != "CLINICAL_KNOWLEDGE_NOT_TRUSTED" {
		t.Fatalf("untrusted knowledge should be blocked, blocked=%v code=%q", blocked, code)
	}
}

func TestKnowledgeEvidenceWithMissingProvenanceFailsClosed(t *testing.T) {
	t.Setenv("HELIOS_CONTEXT_SIGNING_KEY", "knowledge-proof-test-key")
	text := `{"evidenceType":"CLINICAL KNOWLEDGE SOURCE","sourceId":"src-demo"}`
	code, _, _, blocked := knowledgeLifecycleFindingFromText(text)
	if !blocked || code != "CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED" {
		t.Fatalf("missing governance metadata must fail closed, blocked=%v code=%q", blocked, code)
	}
}

func TestMixedActiveAndStaleEvidenceIsBlocked(t *testing.T) {
	active := testKnowledgeProof(t, "src-v3", "ACTIVE", "TRUSTED_GOVERNED", true)
	stale := testKnowledgeProof(t, "src-v2", "STALE", "TRUSTED_GOVERNED", false)
	text := fmt.Sprintf(`[
	  {"evidenceType":"CLINICAL KNOWLEDGE SOURCE","sourceId":"src-v3","lifecycleState":"ACTIVE","trustClassification":"TRUSTED_GOVERNED","eligibleForRetrieval":true,"signatureState":"valid-demo-hmac","knowledgeProof":"%s"},
	  {"evidenceType":"CLINICAL KNOWLEDGE SOURCE","sourceId":"src-v2","lifecycleState":"STALE","trustClassification":"TRUSTED_GOVERNED","eligibleForRetrieval":false,"signatureState":"valid-demo-hmac","knowledgeProof":"%s"}
	]`, active, stale)
	code, _, _, blocked := knowledgeLifecycleFindingFromText(text)
	if !blocked || code != "CLINICAL_KNOWLEDGE_NOT_ACTIVE" {
		t.Fatalf("any stale evidence must block the request, blocked=%v code=%q", blocked, code)
	}
}

func TestTamperedKnowledgeProofFailsClosed(t *testing.T) {
	proof := testKnowledgeProof(t, "src-v3", "ACTIVE", "TRUSTED_GOVERNED", true) + "tampered"
	text := fmt.Sprintf(`{"evidenceType":"CLINICAL KNOWLEDGE SOURCE","sourceId":"src-v3","lifecycleState":"ACTIVE","trustClassification":"TRUSTED_GOVERNED","eligibleForRetrieval":true,"signatureState":"valid-demo-hmac","knowledgeProof":"%s"}`, proof)
	code, _, _, blocked := knowledgeLifecycleFindingFromText(text)
	if !blocked || code != "CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED" {
		t.Fatalf("tampered proof must fail closed, blocked=%v code=%q", blocked, code)
	}
}

func TestInvalidSourceContentSignatureStateFailsClosed(t *testing.T) {
	proof := testKnowledgeProof(t, "src-v3", "ACTIVE", "TRUSTED_GOVERNED", true)
	text := fmt.Sprintf(`{"evidenceType":"CLINICAL KNOWLEDGE SOURCE","sourceId":"src-v3","lifecycleState":"ACTIVE","trustClassification":"TRUSTED_GOVERNED","eligibleForRetrieval":true,"signatureState":"unsigned","knowledgeProof":"%s"}`, proof)
	code, _, _, blocked := knowledgeLifecycleFindingFromText(text)
	if !blocked || code != "CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED" {
		t.Fatalf("unsigned source content must fail closed, blocked=%v code=%q", blocked, code)
	}
}
