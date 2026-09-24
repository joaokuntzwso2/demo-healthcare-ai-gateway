package customtooldelegationguard

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

const policyName = "custom-tool-delegation-guard"

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
func messagesText(v map[string]interface{}) string {
	raw, ok := v["messages"].([]interface{})
	if !ok {
		return ""
	}
	var b strings.Builder
	for _, m := range raw {
		if mm, ok := m.(map[string]interface{}); ok {
			if s, ok := mm["content"].(string); ok {
				b.WriteString(s)
				b.WriteByte('\n')
			}
		}
	}
	return b.String()
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

const heliosContextHeader = "X-Helios-Clinical-Context"
const heliosSignatureHeader = "X-Helios-Clinical-Signature"

func contextMap(req *policy.RequestContext) map[string]interface{} {
	if req == nil || req.Headers == nil {
		return nil
	}
	values := req.Headers.Get(heliosContextHeader)
	if len(values) != 1 {
		return nil
	}
	encoded := strings.TrimSpace(values[0])
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil
	}
	var c map[string]interface{}
	if json.Unmarshal(raw, &c) != nil {
		return nil
	}
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
func validContextSignature(req *policy.RequestContext) bool {
	key := os.Getenv("HELIOS_CONTEXT_SIGNING_KEY")
	if key == "" || req == nil || req.Headers == nil {
		return false
	}
	cv := req.Headers.Get(heliosContextHeader)
	sv := req.Headers.Get(heliosSignatureHeader)
	if len(cv) != 1 || len(sv) != 1 {
		return false
	}
	encoded := strings.TrimSpace(cv[0])
	supplied, err := hex.DecodeString(strings.TrimSpace(sv[0]))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(encoded))
	expected := mac.Sum(nil)
	return hmac.Equal(supplied, expected)
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
	c := contextMap(req)
	if c == nil {
		return nil
	}
	allowedClin := map[string]bool{"get_patient_summary": true, "get_encounter": true, "get_recent_labs": true, "get_medications": true, "get_allergies": true, "get_conditions": true, "search_clinical_knowledge": true, "check_medication_safety": true, "draft_clinical_note": true, "request_medication_order": true, "request_test_order": true, "submit_for_clinician_approval": true, "get_restricted_clinical_information": true}
	allowedPatient := map[string]bool{"get_own_appointment": true, "get_own_approved_instructions": true, "search_patient_education": true, "request_callback": true}
	for _, n := range toolNames(v) {
		ok := allowedClin[n]
		if str(c, "app") == "patient-support" {
			ok = allowedPatient[n]
		}
		if !ok {
			setFinding(req, "CLINICAL_DATA_NOT_AUTHORIZED", "Requested tool is not allowed for this application context.", map[string]interface{}{"tool": n})
			break
		}
	}
	return nil
}
