package customtooldelegationguard

import "testing"

func roleCtx(role string, scopes ...string) map[string]interface{} {
	raw := make([]interface{}, len(scopes))
	for i, s := range scopes {
		raw[i] = s
	}
	return map[string]interface{}{"role": role, "scopes": raw}
}

func TestPhysicianGetsActionRequestWithScope(t *testing.T) {
	c := roleCtx("attending-physician", "clinical-action:request")
	if !clinicianToolAllowedForRole(c, "request_medication_order") {
		t.Fatal("physician with action scope should be allowed the request tool")
	}
}

func TestPharmacistGetsMedicationSafetyButNotOrder(t *testing.T) {
	c := roleCtx("clinical-pharmacist", "medication-safety:read", "clinical-action:request")
	if !clinicianToolAllowedForRole(c, "check_medication_safety") {
		t.Fatal("pharmacist should be allowed medication safety")
	}
	if clinicianToolAllowedForRole(c, "request_medication_order") {
		t.Fatal("pharmacist must not gain physician order-request authority even if a scope is accidentally present")
	}
}

func TestNurseGetsLabsButNotMedicationOrder(t *testing.T) {
	c := roleCtx("registered-nurse", "labs:read", "clinical-action:request")
	if !clinicianToolAllowedForRole(c, "get_recent_labs") {
		t.Fatal("nurse with labs scope should receive the lab tool")
	}
	if clinicianToolAllowedForRole(c, "request_medication_order") {
		t.Fatal("nurse must not receive physician action-request tool")
	}
}

func TestCareManagerCannotReceiveLabTool(t *testing.T) {
	c := roleCtx("care-manager", "labs:read")
	if clinicianToolAllowedForRole(c, "get_recent_labs") {
		t.Fatal("care manager must remain care-coordination-only even if a lab scope is accidentally present")
	}
}

func TestRestrictedToolRequiresPhysicianRoleAndExplicitScope(t *testing.T) {
	without := roleCtx("attending-physician")
	if clinicianToolAllowedForRole(without, "get_restricted_clinical_information") {
		t.Fatal("restricted tool must require explicit restricted scope")
	}
	with := roleCtx("attending-physician", "restricted:behavioral-health:read")
	if !clinicianToolAllowedForRole(with, "get_restricted_clinical_information") {
		t.Fatal("authorized physician restricted scope should remain supported")
	}
}

func TestRestrictedToolDelegationRequiresExplicitScope(t *testing.T) {
	withScope := roleCtx(
		"behavioral-health-clinician",
		"restricted:behavioral-health:read",
	)

	if !clinicianToolAllowedForRole(
		withScope,
		"get_restricted_clinical_information",
	) {
		t.Fatal(
			"tool-delegation layer should preserve restricted tool when explicit restricted scope is present",
		)
	}

	withoutScope := roleCtx("behavioral-health-clinician")

	if clinicianToolAllowedForRole(
		withoutScope,
		"get_restricted_clinical_information",
	) {
		t.Fatal(
			"restricted tool delegation must still require explicit restricted scope",
		)
	}
}
