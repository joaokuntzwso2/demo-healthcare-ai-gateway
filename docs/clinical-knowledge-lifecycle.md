# Clinical knowledge lifecycle

Helios demonstrates that clinical knowledge is governed as versioned evidence, not treated as arbitrary text retrieved from a vector index.

## Synthetic scenario

Three sources represent different lifecycle/trust states:

1. **Guideline v3**
   - Publisher: Helios Clinical Governance
   - Lifecycle: `ACTIVE`
   - Trust: `TRUSTED_GOVERNED`
   - Source-content provenance: valid demo HMAC
   - Gateway governance proof: HMAC-SHA256 signed with the Helios/Gateway shared verification key
   - Retrieval eligible: yes
   - Supersedes v2

2. **Guideline v2**
   - Publisher: Helios Clinical Governance
   - Lifecycle: `STALE`
   - Trust: `TRUSTED_GOVERNED`
   - Retrieval eligible: no
   - Review-expired and superseded by v3
   - Remains visible for audit/provenance

3. **External referral upload**
   - Publisher: External Referral Partner
   - Lifecycle: `QUARANTINED`
   - Trust: `UNTRUSTED_EXTERNAL_EVIDENCE`
   - Retrieval eligible: no
   - Contains deliberate model-directed prompt-injection instructions
   - Raw quarantined content is not exposed by the lifecycle API

## Retrieval contract

Knowledge can influence model reasoning only when all are true:

`lifecycleState == ACTIVE`

and

`trustClassification == TRUSTED_GOVERNED`

and

`signatureState == valid-demo-hmac`

and

`knowledgeProof == valid Gateway-verifiable HMAC`

and

`eligibleForRetrieval == true`

Version/provenance fields include publisher, version, effective date, review date, SHA-256 digest, source signature state, tenant, specialty, channel, knowledge key and supersession links. A separate `knowledgeProof` cryptographically binds source ID, digest, publisher, version, lifecycle state, trust classification and retrieval eligibility for independent verification at WSO2.

## Defense in depth

Application/RAG:
- stale/superseded documents remain catalogued but are excluded from `searchKnowledge`
- quarantined/untrusted sources cannot be returned as clinical knowledge
- retrieval results carry lifecycle/trust/provenance fields

WSO2 AI Gateway:
- `custom-trusted-clinical-source-guard` independently verifies the HMAC-signed `knowledgeProof` and rejects missing/tampered provenance, stale/non-active lifecycle, untrusted classification, or retrieval-ineligible evidence
- `custom-clinical-note-injection-guard` rejects malicious referral/model-directed instructions
- direct Gateway probes deliberately bypass application retrieval filtering to prove independent enforcement

## Executive message

**Clinical knowledge is not trusted because it was retrieved. It is retrieved because it is trusted, current and provenance-verifiable.**
