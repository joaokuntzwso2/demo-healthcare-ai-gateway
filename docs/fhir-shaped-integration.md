# FHIR-shaped clinical integration

Helios exposes **FHIR R4-shaped synthetic resources** alongside its existing deterministic tool evidence.

This is intentionally an interoperability adapter, not a FHIR server and not a claim of US Core/profile conformance.

## Why R4 here

The demo targets FHIR 4.0.1 resource shapes because R4 remains a common compatibility baseline across deployed healthcare implementation guides. The adapter is isolated so a production implementation can replace it with actual hospital FHIR endpoints and locally required profiles.

## Mapping

| Helios source | FHIR-shaped artifact |
|---|---|
| LAB-SYSTEM | `Observation` + `Provenance` |
| EHR-ENCOUNTERS | `Encounter` + `Provenance` |
| EHR-MEDICATIONS | `MedicationStatement` + `Provenance` |
| EHR-ALLERGIES | `AllergyIntolerance` + `Provenance` |
| EHR-CONDITIONS | `Condition` + `Provenance` |
| SCHEDULING | `Appointment` + `Provenance` |
| Patient context | minimal pseudonymous `Patient` |

## Security properties

- The browser still does not read patient fixtures directly.
- Authorization, patient assignment, purpose, scopes and tool permission are evaluated before FHIR artifacts are created.
- FHIR resources use the patient pseudonym as the FHIR Patient id; the internal `pat-*` identifier is not placed into the generated bundle.
- The original compact Helios evidence remains authoritative for grounding.
- FHIR artifacts are retained for UI/audit/interoperability storytelling but are stripped from the second LLM tool-message payload to avoid duplicating tokens.
- Synthetic codes use a Helios demonstration CodeSystem rather than falsely claiming production LOINC/SNOMED coding.

## Production replacement

A production deployment should replace the adapter with actual hospital interoperability services/FHIR endpoints, perform profile validation, use production terminology mappings, preserve source version identifiers, enforce the hospital's OAuth/SMART/security model, and persist provenance/audit records.
