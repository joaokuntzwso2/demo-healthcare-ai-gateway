package customtenantworkforcecontextguard

import "testing"

func tc(a, p, r string, s bool) map[string]interface{} {
	return map[string]interface{}{"tenant": a, "patientTenant": p, "tenantBoundary": map[string]interface{}{"actorTenant": a, "patientTenant": p, "requestedTenant": r, "sameTenant": s, "policy": "STRICT_TENANT_ISOLATION", "version": "tenant-boundary-v1"}}
}
func TestTenantBoundaryAllowsSameHospital(t *testing.T) {
	ok, c, _, _ := tenantBoundaryFinding(tc("helios-north", "helios-north", "helios-north", true))
	if !ok || c != "" {
		t.Fatalf("same tenant failed ok=%v code=%q", ok, c)
	}
}
func TestTenantBoundaryBlocksCrossHospital(t *testing.T) {
	ok, c, _, _ := tenantBoundaryFinding(tc("helios-north", "aurora-br", "aurora-br", false))
	if ok || c != "TENANT_BOUNDARY_VIOLATION" {
		t.Fatalf("cross tenant not blocked ok=%v code=%q", ok, c)
	}
}
func TestTenantBoundaryFailsClosedWithoutPatientTenant(t *testing.T) {
	ok, c, _, _ := tenantBoundaryFinding(tc("helios-north", "", "helios-north", false))
	if ok || c != "CLINICAL_DATA_NOT_AUTHORIZED" {
		t.Fatalf("missing tenant not closed ok=%v code=%q", ok, c)
	}
}
func TestTenantBoundaryRejectsInconsistentSignedDecision(t *testing.T) {
	ok, c, _, _ := tenantBoundaryFinding(tc("helios-north", "aurora-br", "aurora-br", true))
	if ok || c != "CLINICAL_DATA_NOT_AUTHORIZED" {
		t.Fatalf("inconsistent decision not blocked ok=%v code=%q", ok, c)
	}
}
