# Conflicting clinical evidence

Helios models disagreement between authoritative clinical sources explicitly rather than converting the disagreement into a single model-selected fact.

## Demonstration

Synthetic patient: Marcus Reed (`pat-1001`)

Medication: Lisinopril

Two authoritative source claims are exposed:

- **Home Medication List** — Lisinopril 10 mg daily
- **Discharge Medication Reconciliation** — Lisinopril 20 mg daily

The reconciliation state is `UNRESOLVED`.

No source is automatically selected as the winner. In particular, the discharge source is newer in this synthetic fixture, but **recency alone is not treated as sufficient authority to resolve the medication dose**.

## Runtime behavior

`get_medications` returns:

- the existing medication records;
- `medicationEvidence.status = CONFLICT`;
- both source claims;
- source identifiers and timestamps;
- a deterministic `MEDICATION_DOSE_CONFLICT`;
- `authoritativeWinner = null`;
- `CLINICAL_EVIDENCE_CONFLICT` advisory.

`get_patient_summary` also carries the conflict so a broad clinical summary cannot silently miss it.

For conflict-bearing evidence, the BFF applies a deterministic answer contract. Even if the LLM says, for example, “the current dose is 20 mg,” the user-visible answer is replaced by a safe conflict narrative that names both sources and values and says that clinician reconciliation is required.

The LLM therefore cannot turn disagreement into false certainty.

## Production analogue

In production, the two claims would normally originate from separate medication workflows or source systems, with provenance from the EHR / medication reconciliation pipeline.

A production implementation may have an authoritative reconciliation outcome, signed pharmacist/clinician attestation, CPOE result, medication-order status or institutional precedence rule. Only such a deterministic result should populate an authoritative winner.

This synthetic demo does not claim that one source class universally outranks another.
