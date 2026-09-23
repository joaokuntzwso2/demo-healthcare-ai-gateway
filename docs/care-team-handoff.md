# Care-team handoff authorization

Helios models longitudinal **care ownership** separately from encounter-specific authorization.

The synthetic demonstration uses George Campbell (`pat-1003`) and three care phases:

1. **Inpatient hospitalist** — Dr. Ethan Kim owns the active inpatient relationship.
2. **Cardiology transition** — Dr. Lena Brooks becomes the active specialty owner after handoff.
3. **Outpatient primary care** — Dr. Avery Morgan (Internal Medicine) becomes the longitudinal outpatient owner.

The active care team—not a permanent physician role—controls patient-context AI authorization for this workflow. Previous owners remain in the handoff history but lose current longitudinal AI access when their relationship ends.

The demo intentionally runs the handoff story with `encounterId: null` so this control is visibly independent from the encounter-lifecycle rule. Encounter authorization and care-team authorization can both exist in production and answer different questions.

The handoff API also exposes a synthetic FHIR R4-shaped `CareTeam` plus `Provenance`. FHIR R4 `CareTeam` supports patient subject, status, period, participants, participant roles and managing organization; this demo uses those shapes for interoperability storytelling but does not claim implementation-guide conformance.

This is a demonstrative institutional authorization model. Real deployments would source current care relationships from the EHR, care-management platform, master patient/relationship service, IAM/PDP or another authoritative workflow source and apply the hospital's policy, regulatory requirements and continuity-of-care rules.
