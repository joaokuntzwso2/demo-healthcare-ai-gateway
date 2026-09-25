package customclinicalactionauthorityguard

import "testing"

func TestPhysicianProfessionalRoles(t *testing.T) {
	for _, role := range []string{"attending-physician", "emergency-physician", "behavioral-health-physician", "hospitalist"} {
		if !physicianProfessionalRole(role) {
			t.Fatalf("%s should be a physician professional role", role)
		}
	}
}

func TestNonPhysicianProfessionalRoles(t *testing.T) {
	for _, role := range []string{"clinical-pharmacist", "registered-nurse", "care-manager"} {
		if physicianProfessionalRole(role) {
			t.Fatalf("%s must not receive physician action authority", role)
		}
	}
}
