# Helios runtime architecture

## Trust and execution boundaries

The live request path is:

1. Clinician or patient UI sends a request to the Node BFF.
2. The BFF resolves identity, tenant, patient, encounter, purpose and application context.
3. The BFF signs internal Helios context and uses the application-specific WSO2 App LLM Proxy key.
4. Model-bound calls propagate W3C traceparent into WSO2 AI Gateway.
5. Clinician traffic uses `/default/clinical-ai-secure/chat/completions`.
6. Patient traffic uses `/default/patient-support-ai-secure/chat/completions`.
7. Host HTTPS Gateway ingress is `https://localhost:18443`.
8. Each proxy applies 27 ordered Gateway stages: 5 WSO2-native stages and 22 Helios healthcare-domain custom policies.
9. WSO2 `request-rewrite` remains last and normalizes the provider-bound path to `/chat/completions`.
10. The local Provider is `helios-enterprise-openai` with a separate Provider X-API-Key boundary.
11. The model may return tool calls, but the BFF remains the execution and authorization authority.
12. Tool results can be sent through the same WSO2 proxy for a second model turn.
13. Response policy, deterministic validation and grounding run before presentation.
14. Helios evidence records the governance decision and, after real Gateway invocation, the correlated WSO2/OpenTelemetry trace ID and Jaeger URL.

## Deployed Gateway policy chain

The deployed chain is 27 stages: 5 WSO2-native stages and 22 Helios custom stages.

1. `api-key-auth` — WSO2 native
2. `custom-model-allowlist-guardrail` — Helios custom
3. `custom-resource-budget-guardrail` — Helios custom
4. `canonicalize-and-classify` — Helios custom
5. `regex-guardrail` — WSO2 native
6. `custom-jailbreak-authority-bypass-guardrail` — Helios custom
7. `custom-request-regex-guardrail` — Helios custom
8. `custom-request-phi-dlp-guardrail` — Helios custom
9. `custom-tenant-workforce-context-guard` — Helios custom
10. `custom-patient-encounter-binding-guard` — Helios custom
11. `custom-purpose-scope-guard` — Helios custom
12. `custom-clinical-note-injection-guard` — Helios custom
13. `custom-sensitive-clinical-context-guard` — Helios custom
14. `custom-trusted-clinical-source-guard` — Helios custom
15. `custom-tool-delegation-guard` — Helios custom
16. `custom-clinical-action-authority-guard` — Helios custom
17. `custom-clinician-approval-guard` — Helios custom
18. `custom-prompt-decorator` — Helios custom
19. `custom-request-block-finalizer` — Helios custom
20. `custom-response-phi-leakage-guard` — Helios custom
21. `custom-unsafe-output-guard` — Helios custom
22. `custom-response-url-guard` — Helios custom
23. `custom-clinical-reliance-guard` — Helios custom
24. `custom-structured-clinical-output-guard` — Helios custom
25. `llm-cost-based-ratelimit` — WSO2 native
26. `llm-cost` — WSO2 native
27. `request-rewrite` — WSO2 native

`llm-cost-based-ratelimit` intentionally precedes `llm-cost` in the configured list because response policies execute in reverse.

`request-rewrite` remains the final configured stage.

## Native AI governance

The WSO2-native Regex Guardrail performs syntactic Argentina DNI and CUIL/CUIT pattern detection before provider processing. This demo does not claim identity lookup or DNI/CUIL/CUIT checksum validation.

WSO2-native LLM cost policies provide per-application operational budget enforcement and accounting. Clinician AI uses USD 0.05 per 24 hours and Patient AI uses USD 0.02 per 24 hours in the event configuration.

Gateway-accounted consumption is operational governance data and is not presented as the external provider invoice.

## Distributed tracing

The BFF propagates W3C traceparent for model-bound calls. After a real WSO2 invocation, Helios evidence stores the WSO2/OpenTelemetry trace ID and a Jaeger link. Application-side blocks before WSO2 intentionally do not receive a fabricated Gateway trace.

The local tracing stack uses an OpenTelemetry Collector and Jaeger.

## Authority model

| Information or action | Authority |
|---|---|
| User and workforce identity | Server-side synthetic identity/context service in demo |
| Tenant, patient and encounter binding | Server-side context service plus signed Gateway context |
| Patient clinical facts | Server-side synthetic clinical data service |
| Clinical knowledge | Protected versioned knowledge service |
| Uploaded or referral content | Evidence only unless promoted through a trusted workflow |
| LLM text | Non-authoritative until validated and grounded |
| Clinical safety fixture result | Deterministic demo safety service |
| Medication or test action | Server-side action-request workflow plus clinician approval |
| Final prescription or diagnostic order execution | Not implemented |

## Local ports

| Host port | Purpose |
|---:|---|
| 5173 | Helios UI and BFF |
| 18443 | WSO2 HTTPS Gateway ingress mapped to container 8443 |
| 18080 | WSO2 HTTP Gateway ingress mapped to container 8080 |
| 8081 | xDS-managed API listener |
| 9090 | WSO2 Controller management API |
| 9094 | Controller admin and health mapped to container 9092 |
| 9011 | Controller metrics mapped to container 9091 |
| 9901 | Envoy runtime admin and readiness |
| 9002 | Policy Engine admin API |
| 9003 | Policy Engine metrics |
| 4317 | OpenTelemetry OTLP gRPC |
| 4318 | OpenTelemetry OTLP HTTP |
| 16686 | Jaeger UI |

## Development-mode warning

The local Controller uses development-mode administration for a reproducible demonstration. It is not a production authentication model.

Production deployment requires enterprise identity, secrets management, hardened TLS and certificate lifecycle, restricted management interfaces, environment-specific authorization, privacy and clinical governance, operational monitoring and formal security validation.
