# Graceful abstention — incomplete sepsis context

This synthetic scenario demonstrates deterministic abstention for a high-stakes diagnostic question.

Question:

> Does this patient have sepsis?

The demo intentionally does not provide the complete authoritative context required by its synthetic completeness policy.

Missing required context:

- current vital signs;
- blood-culture results.

The patient may still have other authoritative evidence available, including current versioned laboratory facts. That evidence is not treated as sufficient to infer a sepsis diagnosis.

## Enforcement point

The clinical-context completeness gate runs after identity/patient authorization and request-security inspection, but before any model or Gateway invocation.

When required context is missing:

- `decision = ABSTAIN`;
- `REQUIRED_CLINICAL_CONTEXT_MISSING` is emitted;
- specific missing-context reason codes are emitted;
- `diagnosticConclusionAllowed = false`;
- `modelInvoked = false`;
- `gatewayInvoked = false`;
- no yes/no diagnosis is generated.

This is stronger than prompting the model to express uncertainty. The model is not given authority to fill missing clinical facts.

## Reason codes

- `REQUIRED_CLINICAL_CONTEXT_MISSING`
- `CURRENT_VITAL_SIGNS_UNAVAILABLE`
- `BLOOD_CULTURE_RESULTS_UNAVAILABLE`

## Important limitation

This is a synthetic completeness demonstration. It is not a validated sepsis diagnostic rule, medical advice, or a production clinical decision-support algorithm.

The architecture principle is:

**Good clinical AI knows when it cannot answer.**
