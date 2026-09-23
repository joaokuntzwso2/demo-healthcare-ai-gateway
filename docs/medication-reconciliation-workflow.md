# Medication reconciliation workflow

This synthetic workflow models a recognizable post-discharge hospital medication-reconciliation process.

## Scenario

A post-discharge synthetic patient has medication evidence from three distinct source classes:

1. **EHR Medication List**
2. **Patient-reported Medications**
3. **Discharge Medication Instructions**

The sources disagree.

### Lisinopril

- EHR Medication List: 10 mg daily
- Patient-reported Medications: 10 mg twice daily
- Discharge Medication Instructions: 20 mg daily

### Furosemide

- EHR Medication List: 20 mg daily
- Patient-reported Medications: not taking
- Discharge Medication Instructions: 40 mg daily

The demo does not claim that any source is universally more authoritative than another.

## Workflow

`SOURCE SNAPSHOT`
→ deterministic discrepancy detection
→ `AI RECONCILIATION DRAFT`
→ `PENDING_HUMAN_RECONCILIATION`
→ clinician resolves each medication or defers for clarification
→ `RECONCILED_HUMAN_REVIEWED` or `PARTIALLY_RECONCILED_HUMAN_REVIEWED`

## Deterministic evidence layer

The server:

- normalizes the three source claims;
- identifies differing fields;
- keeps `authoritativeWinner = null` before human review;
- records source IDs, classes, systems and timestamps;
- creates a SHA-256 snapshot hash;
- binds the AI review and human decision to the same evidence snapshot.

No model output can populate an authoritative winner.

## AI layer

The governed clinical model is invoked through `clinical-ai-secure`.

It may:

- compare source claims;
- summarize discrepancies;
- explain what requires clarification;
- draft a reconciliation review.

It may not:

- select the authoritative medication state;
- declare a final current dose;
- prescribe;
- discontinue;
- change a medication;
- write the EHR;
- create an order.

## Human reconciliation

For each medication, the clinician explicitly chooses one of:

- `USE_EHR`
- `USE_PATIENT_REPORTED`
- `USE_DISCHARGE`
- `DEFER_CLARIFICATION`

A source becomes the demo's reconciled medication claim only because the human reviewer selected it.

`DEFER_CLARIFICATION` is a first-class outcome and does not manufacture certainty.

## Non-execution boundary

Even after human reconciliation:

- `ehrWritebackSupported = false`
- `ehrWritten = false`
- `prescriptionChanged = false`
- `orderCreated = false`

The demonstration records workflow decisions only.

A production implementation could separately hand a clinician-approved reconciliation artifact to an authorized EHR/CPOE integration. That write-back path is intentionally absent here.

## Architecture principle

**AI can organize conflicting medication evidence; the clinician owns the reconciled medication state.**

This is a synthetic demonstration and is not medical advice.
