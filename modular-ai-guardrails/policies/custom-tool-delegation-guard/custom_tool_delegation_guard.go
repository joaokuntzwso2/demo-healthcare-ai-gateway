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

func professionalRoleFamily(role string) string {
	r := strings.ToLower(strings.TrimSpace(role))
	if strings.Contains(r, "behavioral-health") {
		if strings.Contains(r, "physician") {
			return "physician"
		}
		return "behavioral-health"
	}
	if r == "hospitalist" || strings.Contains(r, "physician") {
		return "physician"
	}
	if strings.Contains(r, "pharmacist") {
		return "pharmacist"
	}
	if strings.Contains(r, "nurse") && !strings.Contains(r, "care-manager") {
		return "nurse"
	}
	if r == "care-manager" || strings.Contains(r, "care manager") {
		return "care-manager"
	}
	return "unrecognized"
}

func requiredProfessionalScope(tool string) string {
	switch tool {
	case "get_patient_summary", "get_encounter":
		return "chart:summary"
	case "get_recent_labs":
		return "labs:read"
	case "get_medications":
		return "medications:read"
	case "get_allergies":
		return "allergies:read"
	case "get_conditions":
		return "conditions:read"
	case "search_clinical_knowledge":
		return "knowledge:read"
	case "check_medication_safety":
		return "medication-safety:read"
	case "draft_clinical_note":
		return "note:draft"
	case "request_medication_order", "request_test_order":
		return "clinical-action:request"
	case "submit_for_clinician_approval":
		return "approval:submit"
	case "get_restricted_clinical_information":
		return "restricted:behavioral-health:read"
	default:
		return ""
	}
}

func knownClinicianTool(tool string) bool {
	switch tool {
	case "get_patient_summary", "get_encounter", "get_recent_labs", "get_medications",
		"get_allergies", "get_conditions", "search_clinical_knowledge",
		"check_medication_safety", "draft_clinical_note", "request_medication_order",
		"request_test_order", "submit_for_clinician_approval", "get_scheduling_context",
		"get_restricted_clinical_information":
		return true
	default:
		return false
	}
}

func clinicianToolAllowedForRole(c map[string]interface{}, tool string) bool {
	/*
		Restricted clinical information has its own stronger authorization
		policy earlier in the Gateway chain. The tool-delegation guard only
		verifies that the explicit restricted scope is present; the
		custom-sensitive-clinical-context-guard independently validates the
		patient authorization, purpose and restricted-record entitlement.

		This prevents the generic professional-role matrix from accidentally
		overriding the dedicated restricted-record authorization model.
	*/
	if tool == "get_restricted_clinical_information" {
		return hasScope(c, "restricted:behavioral-health:read")
	}

	family := professionalRoleFamily(str(c, "role"))
	roleAllowed := false
	switch family {
	case "physician":
		roleAllowed = knownClinicianTool(tool)
	case "behavioral-health":
		switch tool {
		case "get_patient_summary", "get_encounter", "get_allergies",
			"search_clinical_knowledge", "draft_clinical_note",
			"get_restricted_clinical_information":
			roleAllowed = true
		}
	case "pharmacist":
		switch tool {
		case "get_recent_labs", "get_medications", "get_allergies", "get_conditions", "search_clinical_knowledge", "check_medication_safety":
			roleAllowed = true
		}
	case "nurse":
		switch tool {
		case "get_patient_summary", "get_encounter", "get_recent_labs", "get_allergies", "search_clinical_knowledge", "draft_clinical_note", "get_scheduling_context":
			roleAllowed = true
		}
	case "care-manager":
		switch tool {
		case "get_patient_summary", "get_encounter", "search_clinical_knowledge", "draft_clinical_note", "get_scheduling_context":
			roleAllowed = true
		}
	}
	if !roleAllowed {
		return false
	}
	if required := requiredProfessionalScope(tool); required != "" && !hasScope(c, required) {
		return false
	}
	return true
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
	allowedPatient := map[string]bool{
		"get_own_appointment":           true,
		"get_own_approved_instructions": true,
		"search_patient_education":      true,
		"request_callback":              true,
	}
	for _, n := range toolNames(v) {
		app := str(c, "app")
		if app == "patient-support" {
			if !allowedPatient[n] {
				setFinding(req, "CLINICAL_DATA_NOT_AUTHORIZED", "Requested tool is not allowed for this application context.", map[string]interface{}{"tool": n})
				break
			}
			continue
		}
		if app != "clinician" || !knownClinicianTool(n) {
			setFinding(req, "CLINICAL_DATA_NOT_AUTHORIZED", "Requested tool is not allowed for this application context.", map[string]interface{}{"tool": n})
			break
		}
		if !clinicianToolAllowedForRole(c, n) {
			setFinding(req, "PROFESSIONAL_ROLE_CAPABILITY_DENIED", "Requested tool is outside the signed professional role and scope boundary.", map[string]interface{}{
				"tool":             n,
				"actorRole":        str(c, "role"),
				"professionalRole": professionalRoleFamily(str(c, "role")),
				"requiredScope":    requiredProfessionalScope(n),
			})
			break
		}
	}
	return nil
}
