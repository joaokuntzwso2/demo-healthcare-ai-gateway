# Data freshness + corrected results

Synthetic scenario: Marcus Reed has one potassium laboratory event with two result versions.

- Version 1: 5.8 mmol/L, event time 08:00, status `SUPERSEDED`.
- Version 2: 4.8 mmol/L, correction issued 09:20, status `CURRENT_CORRECTED`.

This is a corrected result in the same result chain, not a second blood draw.

The deterministic selection rule is:

`LATEST_VALID_VERSION_IN_RESULT_CHAIN`

`get_recent_labs` and the patient summary expose 4.8 mmol/L as the current clinical fact. Version 1 remains available only in `labResultLineage` as provenance.

If a model tries to report 5.8 mmol/L as current, the BFF replaces that response with a deterministic version-aware narrative.

Architecture principle:

**Grounding proves a value came from evidence; version selection proves it is the current authoritative value.**
