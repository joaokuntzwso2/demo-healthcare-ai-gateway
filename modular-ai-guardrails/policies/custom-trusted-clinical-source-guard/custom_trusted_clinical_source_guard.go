package customtrustedclinicalsourceguard

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	policy "github.com/wso2/api-platform/sdk/core/policy/v1alpha2"
	"html"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const policyName = "custom-trusted-clinical-source-guard"

const pendingKey = "wso2.ai.pending-request-block"
const canonicalKey = "helios.canonical-text"

type Policy struct{}

func (p *Policy) Mode() policy.ProcessingMode {
	return policy.ProcessingMode{RequestHeaderMode: policy.HeaderModeSkip, RequestBodyMode: policy.BodyModeBuffer, ResponseHeaderMode: policy.HeaderModeSkip, ResponseBodyMode: policy.BodyModeSkip}
}
func GetPolicy(_ policy.PolicyMetadata, _ map[string]interface{}) (policy.Policy, error) {
	return &Policy{}, nil
}
func parseRequest(c *policy.RequestContext) (map[string]interface{}, error) {
	if c == nil || c.Body == nil || len(c.Body.Content) == 0 {
		return nil, fmt.Errorf("request body missing")
	}
	var v map[string]interface{}
	if err := json.Unmarshal(c.Body.Content, &v); err != nil {
		return nil, err
	}
	return v, nil
}
func ensureMetadata(c *policy.RequestContext) {
	if c.Metadata == nil {
		c.Metadata = map[string]interface{}{}
	}
}
func setFinding(c *policy.RequestContext, code, reason string, details map[string]interface{}) {
	ensureMetadata(c)
	if _, exists := c.Metadata[pendingKey]; exists {
		return
	}
	c.Metadata[pendingKey] = map[string]interface{}{"policy": policyName, "reasonCode": code, "reason": reason, "details": details}
}
func textParam(v map[string]interface{}, key, def string) string {
	if x, ok := v[key].(string); ok {
		return x
	}
	return def
}
func floatParam(v map[string]interface{}, key string, def float64) float64 {
	if x, ok := v[key].(float64); ok {
		return x
	}
	return def
}
func boolParam(v map[string]interface{}, key string, def bool) bool {
	if x, ok := v[key].(bool); ok {
		return x
	}
	return def
}
func userMessagesText(v map[string]interface{}) string {
	raw, ok := v["messages"].([]interface{})
	if !ok {
		return ""
	}
	var b strings.Builder
	for _, m := range raw {
		mm, ok := m.(map[string]interface{})
		if !ok || str(mm, "role") != "user" {
			continue
		}
		if s, ok := mm["content"].(string); ok {
			b.WriteString(s)
			b.WriteByte('\n')
		}
	}
	return b.String()
}
func allMessagesText(v map[string]interface{}) string {
	raw, ok := v["messages"].([]interface{})
	if !ok {
		return ""
	}
	var b strings.Builder
	for _, m := range raw {
		mm, ok := m.(map[string]interface{})
		if !ok {
			continue
		}
		switch x := mm["content"].(type) {
		case string:
			b.WriteString(x)
			b.WriteByte('\n')
		default:
			if encoded, err := json.Marshal(x); err == nil {
				b.Write(encoded)
				b.WriteByte('\n')
			}
		}
	}
	return b.String()
}

func verifyKnowledgeProof(proof string) (map[string]string, string, string, map[string]interface{}, bool) {
	key := os.Getenv("HELIOS_CONTEXT_SIGNING_KEY")
	if key == "" {
		return nil,
			"CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED",
			"Gateway knowledge provenance verification key is unavailable.",
			nil,
			false
	}

	parts := strings.Split(proof, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil,
			"CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED",
			"Clinical knowledge provenance proof is malformed.",
			nil,
			false
	}

	decoded, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil,
			"CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED",
			"Clinical knowledge provenance proof cannot be decoded.",
			nil,
			false
	}

	payload := string(decoded)
	fields := strings.Split(payload, "|")
	if len(fields) != 7 {
		return nil,
			"CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED",
			"Clinical knowledge provenance proof has an invalid payload.",
			nil,
			false
	}

	mac := hmac.New(sha256.New, []byte(key))
	mac.Write(decoded)
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(strings.ToLower(parts[1])), []byte(strings.ToLower(expected))) {
		return nil,
			"CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED",
			"Clinical knowledge provenance HMAC verification failed.",
			map[string]interface{}{"sourceId": fields[0]},
			false
	}

	return map[string]string{
		"sourceId":             fields[0],
		"sha256":               fields[1],
		"publisher":            fields[2],
		"version":              fields[3],
		"lifecycleState":       strings.ToUpper(strings.TrimSpace(fields[4])),
		"trustClassification":  strings.ToUpper(strings.TrimSpace(fields[5])),
		"eligibleForRetrieval": strings.ToLower(strings.TrimSpace(fields[6])),
	}, "", "", nil, true
}

func knowledgeLifecycleFindingFromText(text string) (string, string, map[string]interface{}, bool) {
	evidenceRe := regexp.MustCompile(`(?i)"evidenceType"\s*:\s*"CLINICAL KNOWLEDGE SOURCE"`)
	sourceIDRe := regexp.MustCompile(`(?i)"sourceId"\s*:\s*"[^"]+"`)
	stateRe := regexp.MustCompile(`(?i)"lifecycleState"\s*:\s*"([^"]+)"`)
	trustRe := regexp.MustCompile(`(?i)"trustClassification"\s*:\s*"([^"]+)"`)
	eligibleRe := regexp.MustCompile(`(?i)"eligibleForRetrieval"\s*:\s*(true|false)`)
	signatureRe := regexp.MustCompile(`(?i)"signatureState"\s*:\s*"([^"]+)"`)
	proofRe := regexp.MustCompile(`(?i)"knowledgeProof"\s*:\s*"([^"]+)"`)

	hasEvidence := evidenceRe.MatchString(text)
	hasSource := sourceIDRe.MatchString(text)

	states := stateRe.FindAllStringSubmatch(text, -1)
	trusts := trustRe.FindAllStringSubmatch(text, -1)
	eligibles := eligibleRe.FindAllStringSubmatch(text, -1)
	signatures := signatureRe.FindAllStringSubmatch(text, -1)
	proofs := proofRe.FindAllStringSubmatch(text, -1)

	// An empty search result may legitimately carry the evidence type without
	// any source entries. Once a source exists, governance metadata plus a
	// cryptographically verifiable knowledge proof are mandatory.
	if !hasEvidence && len(states) == 0 && len(trusts) == 0 && len(eligibles) == 0 && len(proofs) == 0 {
		return "", "", nil, false
	}

	if hasEvidence && hasSource &&
		(len(states) == 0 || len(trusts) == 0 || len(eligibles) == 0 || len(signatures) == 0 || len(proofs) == 0) {
		return "CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED",
			"Clinical knowledge evidence must carry lifecycle, trust, eligibility, content-signature state and a Gateway-verifiable provenance proof.",
			map[string]interface{}{"sourceMetadataComplete": false},
			true
	}

	for _, m := range proofs {
		fields, code, reason, details, valid := verifyKnowledgeProof(m[1])
		if !valid {
			return code, reason, details, true
		}
		if fields["trustClassification"] != "TRUSTED_GOVERNED" {
			return "CLINICAL_KNOWLEDGE_NOT_TRUSTED",
				"Signed clinical knowledge provenance is not classified as trusted governed knowledge.",
				map[string]interface{}{"sourceId": fields["sourceId"], "trustClassification": fields["trustClassification"]},
				true
		}
		if fields["lifecycleState"] != "ACTIVE" {
			return "CLINICAL_KNOWLEDGE_NOT_ACTIVE",
				"Signed clinical knowledge provenance is stale, superseded, evidence-only, or quarantined.",
				map[string]interface{}{"sourceId": fields["sourceId"], "lifecycleState": fields["lifecycleState"]},
				true
		}
		if fields["eligibleForRetrieval"] != "true" {
			return "CLINICAL_KNOWLEDGE_NOT_ACTIVE",
				"Signed clinical knowledge provenance marks the source ineligible for model retrieval.",
				map[string]interface{}{"sourceId": fields["sourceId"], "eligibleForRetrieval": fields["eligibleForRetrieval"]},
				true
		}
	}

	// Visible metadata must agree with the signed governance decision. This
	// prevents callers from pairing a valid active proof with stale/untrusted
	// lifecycle labels in the same request.
	for _, m := range trusts {
		trust := strings.ToUpper(strings.TrimSpace(m[1]))
		if trust != "TRUSTED_GOVERNED" {
			return "CLINICAL_KNOWLEDGE_NOT_TRUSTED",
				"Clinical knowledge evidence is not classified as trusted governed knowledge.",
				map[string]interface{}{"trustClassification": trust},
				true
		}
	}

	for _, m := range states {
		state := strings.ToUpper(strings.TrimSpace(m[1]))
		if state != "ACTIVE" {
			return "CLINICAL_KNOWLEDGE_NOT_ACTIVE",
				"Clinical knowledge evidence is stale, superseded, evidence-only, or quarantined.",
				map[string]interface{}{"lifecycleState": state},
				true
		}
	}

	for _, m := range eligibles {
		eligible := strings.ToLower(m[1])
		if eligible == "false" {
			return "CLINICAL_KNOWLEDGE_NOT_ACTIVE",
				"Clinical knowledge evidence is not eligible for model retrieval.",
				map[string]interface{}{"eligibleForRetrieval": eligible},
				true
		}
	}

	for _, m := range signatures {
		signature := strings.ToLower(strings.TrimSpace(m[1]))
		if signature != "valid-demo-hmac" {
			return "CLINICAL_KNOWLEDGE_PROVENANCE_REQUIRED",
				"Clinical knowledge evidence does not carry valid source-content provenance.",
				map[string]interface{}{"signatureState": signature},
				true
		}
	}

	return "", "", map[string]interface{}{
		"sourceMetadataComplete": true,
		"gatewayProofVerified":   len(proofs) > 0,
	}, false
}

func canonicalize(s string) string {
	out := html.UnescapeString(strings.TrimSpace(s))
	if d, err := url.QueryUnescape(out); err == nil {
		out = d
	}
	tokens := strings.Fields(out)
	for _, t := range tokens {
		tt := strings.Trim(t, ".,;:()[]{}<>\"'")
		if len(tt) >= 24 && len(tt)%4 == 0 {
			if b, err := base64.StdEncoding.DecodeString(tt); err == nil {
				d := string(b)
				if regexp.MustCompile(`[A-Za-z]{4}`).MatchString(d) {
					out += "\n" + d
				}
			}
		}
	}
	return out
}
func contextMap(v map[string]interface{}) map[string]interface{} {
	c, _ := v["_helios_context"].(map[string]interface{})
	return c
}
func str(m map[string]interface{}, k string) string { v, _ := m[k].(string); return v }
func scopes(m map[string]interface{}) []string {
	raw, _ := m["scopes"].([]interface{})
	out := make([]string, 0, len(raw))
	for _, x := range raw {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}
func hasScope(m map[string]interface{}, want string) bool {
	for _, s := range scopes(m) {
		if s == want {
			return true
		}
	}
	return false
}
func signedContextPayload(m map[string]interface{}) string {
	return strings.Join([]string{str(m, "tenant"), str(m, "actor"), str(m, "role"), str(m, "patientId"), str(m, "patientPseudonym"), str(m, "encounter"), str(m, "purpose"), str(m, "app"), strings.Join(scopes(m), ",")}, "|")
}
func validContextSignature(m map[string]interface{}) bool {
	key := os.Getenv("HELIOS_CONTEXT_SIGNING_KEY")
	if key == "" {
		return false
	}
	sig := str(m, "sig")
	if sig == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(signedContextPayload(m)))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(sig), []byte(expected))
}
func candidateIDs(text, prefix string) []string {
	re := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(prefix) + `[a-z0-9-]+\b`)
	return re.FindAllString(text, -1)
}
func containsAny(s string, patterns ...string) bool {
	for _, p := range patterns {
		if regexp.MustCompile(p).MatchString(s) {
			return true
		}
	}
	return false
}
func countMessages(v map[string]interface{}) int {
	a, _ := v["messages"].([]interface{})
	return len(a)
}
func countTools(v map[string]interface{}) int { a, _ := v["tools"].([]interface{}); return len(a) }
func toolNames(v map[string]interface{}) []string {
	a, _ := v["tools"].([]interface{})
	out := []string{}
	for _, x := range a {
		m, _ := x.(map[string]interface{})
		fn, _ := m["function"].(map[string]interface{})
		if n, ok := fn["name"].(string); ok {
			out = append(out, n)
		}
	}
	return out
}
func intField(v map[string]interface{}, k string) int {
	switch x := v[k].(type) {
	case float64:
		return int(x)
	case int:
		return x
	case string:
		i, _ := strconv.Atoi(x)
		return i
	}
	return 0
}

func (p *Policy) OnRequestBody(_ context.Context, req *policy.RequestContext, _ map[string]interface{}) policy.RequestAction {
	v, err := parseRequest(req)
	if err != nil {
		setFinding(req, "INVALID_REQUEST_STRUCTURE", "Request must be valid JSON.", nil)
		return nil
	}
	text := userMessagesText(v)
	if containsAny(text, `(?i)\b(?:invent|fabricate|make\s+up)\b.{0,80}\b(?:lab|allergy|diagnosis|medication|vital|test\s+result)\b`, `(?i)\bsay\s+the\s+(?:potassium|lab|allergy)\s+(?:was|is)\b`) {
		setFinding(req, "TRUSTED_CLINICAL_SOURCE_REQUIRED", "Authoritative patient facts must come from trusted server-side clinical resources.", nil)
		return nil
	}

	if code, reason, details, blocked := knowledgeLifecycleFindingFromText(allMessagesText(v)); blocked {
		setFinding(req, code, reason, details)
	}
	return nil
}
