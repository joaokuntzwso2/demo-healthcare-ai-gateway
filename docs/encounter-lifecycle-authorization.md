# Encounter lifecycle authorization

Helios models two separate authorization dimensions:

1. **Patient-level care relationship** — a clinician may have a legitimate longitudinal relationship with a patient.
2. **Encounter-level entitlement** — a clinician must also be an active participant in the selected episode when the AI request is explicitly encounter-scoped.

The synthetic demonstration uses Marcus Reed (`pat-1001`) and encounter `enc-501`.

## Active nephrology encounter

Dr. Priya Nair is both assigned to Marcus and an active participant in `enc-501`.

Expected: allowed.

## Transfer

The demo can transfer `enc-501` to Dr. Avery Morgan. The FHIR Encounter remains `in-progress`, but Priya's participant period ends and Avery becomes the current owner/active participant.

Expected:

- Priya + Marcus + `enc-501` → `ENCOUNTER_ACCESS_EXPIRED`
- Avery + Marcus + `enc-501` → allowed

This models a change in episode-of-care authorization without removing Priya's broader patient-level care relationship.

## Discharge

Discharge changes the FHIR-shaped Encounter status to `finished`, closes the period and ends active participants.

Expected: encounter-scoped AI access returns `ENCOUNTER_ACCESS_EXPIRED`.

This is a **synthetic institution policy for encounter-scoped AI context**, not a claim that clinicians universally lose all lawful EHR/chart access immediately after discharge. Production policy would be driven by the hospital's IAM/PDP, EHR context, treatment relationship, local regulation and organizational policy.

## Demo reset

Lifecycle overrides are in-memory and reset on process restart. The UI also has **Reset active** so every presentation can return `enc-501` to its known initial state.
