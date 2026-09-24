# Restricted clinical information

This synthetic demonstration models a clinical category that requires authorization beyond ordinary chart access.

## Scenario

Patient: Nadia Rahman (`pat-1004`)

Restricted category: Behavioral Health

Ordinary clinician: Dr. Mateo Ruiz (`endo-001`)

Restricted clinician: Dr. Hannah Lee (`bh-001`)

The ordinary endocrinologist has a valid patient care relationship and ordinary chart access, but does not receive the separately protected behavioral-health segment.

The behavioral-health clinician receives the segment only when all of the following are true:

1. same tenant;
2. active patient care relationship;
3. `restricted:behavioral-health:read` scope;
4. active synthetic patient authorization for that actor;
5. server-bound purpose `behavioral-health-treatment`.

The restricted record is stored separately from the normal synthetic patient chart.

## Enforcement layers

- BFF preflight: denied requests stop before model/Gateway invocation.
- WSO2 AI Gateway: the signed Helios context carries the restricted authorization decision; direct proxy probes are blocked by `custom-sensitive-clinical-context-guard`.
- Server tool: `get_restricted_clinical_information` recomputes authorization before releasing the segment.

## Reason code

`RESTRICTED_RECORD_ACCESS_DENIED`

## Executive message

Having access to the patient does not mean having access to every category of information about the patient.

This is a synthetic governance demonstration. It does not make a jurisdiction-specific legal claim about behavioral-health, psychotherapy-note, substance-use, HIPAA, LGPD, or other regulatory requirements.
