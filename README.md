# Helios Clinical AI Security

**Repository:** `healthcare-ai-gateway-demo`
**Demo:** Helios Clinical AI Security

Helios is a synthetic healthcare AI security and safety demonstration built around a **real WSO2 AI Gateway request path**, two independently secured App LLM Proxies, a model-driven clinician copilot, a lower-privilege patient-support application, deterministic clinical reference/safety services, protected RAG, and evidence/tracing.

> **Safety boundary:** This demo is not medical advice, not an autonomous diagnosis system, not a prescribing engine, not FDA clearance, not Anvisa registration, and does not establish HIPAA or LGPD compliance. All patient data and clinical safety fixtures are synthetic and demonstrative.

## What runs end to end

The default `./run.sh` path is not a mocked chat path. It runs:

```text
Browser
  -> Helios React console
  -> Node BFF / clinical authority boundary
  -> /default/clinical-ai-secure OR /default/patient-support-ai-secure
  -> WSO2 AI Gateway host ingress :18443
  -> ordered 27-stage policy chain (5 WSO2-native + 22 Helios custom Go stages)
  -> helios-enterprise-openai
  -> OpenAI model
  -> tool_call returned through WSO2
  -> BFF validates tenant/patient/encounter/purpose/scope and executes allowed server tool
  -> tool result returned through WSO2 AI Gateway
  -> model final response
  -> response policies + grounding/safety validation
  -> Helios evidence + W3C/OpenTelemetry trace correlation + UI
```

The LLM can select a tool, but it cannot make authoritative patient facts or clinical actions true. Patient facts come from server-side synthetic clinical resources. Medication/test actions become approval-bound request objects; this demo never executes a prescription or diagnostic order.

## First real end-to-end run

Prerequisites:

- a running Docker-compatible daemon such as Docker Desktop or Colima
- Node.js 20+
- Go 1.23+
- WSO2 `ap` CLI with `ap gateway image build`
- `curl`, `openssl`, `python3`
- an OpenAI API key for the local `helios-enterprise-openai` provider

Run:

```bash
chmod +x run.sh scripts/*.sh modular-ai-guardrails/scripts/*.sh
./run.sh
```

If `OPENAI_API_KEY` is not already exported, `run.sh` prompts for it with terminal echo disabled. The key is used to configure the local WSO2 provider and is **not written to `.helios.env`**.

The runner then:

1. validates prerequisites and generates local demo signing secrets;
2. validates/compiles all 22 Helios custom Go policy modules and validates the WSO2 built-ins required by the reference runtime;
3. runs `ap gateway image build --name healthcare-ai-security-gateway`;
4. starts the custom WSO2 Gateway Controller and Runtime;
5. creates/updates `helios-enterprise-openai`;
6. creates `clinical-ai-secure` and `patient-support-ai-secure`;
7. creates a separately authenticated Provider boundary and generates a Provider access key;
8. configures both App LLM Proxies to call `helios-enterprise-openai` with that Provider key;
9. applies the exact, distinct 27-stage policy chains and generates separate clinician/patient proxy keys;
10. performs live Provider, positive-proxy and adversarial Gateway acceptance tests;
11. performs a live model-driven tool-call test for an authoritative lab value;
12. starts the Helios BFF/UI in `LLM_MODE=gateway` only after those checks pass.

Endpoints after a successful run:

| Component | URL |
|---|---|
| Helios UI | `http://localhost:5173` |
| BFF health | `http://localhost:5173/api/health` |
| Live Gateway status | `http://localhost:5173/api/gateway-status` |
| WSO2 Gateway ingress | `https://localhost:18443` |
| WSO2 Controller management | `http://localhost:9090` |
| Controller health | `http://localhost:9094/api/admin/v1/health` |
| Runtime readiness | `http://localhost:9901/ready` |
| Jaeger UI | `http://localhost:16686` |
| OpenTelemetry OTLP gRPC | `localhost:4317` |
| OpenTelemetry OTLP HTTP | `localhost:4318` |

Useful commands:

```bash
./run.sh status      # BFF + WSO2 health + containers
./run.sh check       # re-run live Gateway/model/tool acceptance
./run.sh test        # local Go/Node/frontend verification
./run.sh stop        # stop BFF/UI + WSO2 containers
./run.sh deterministic  # optional offline non-LLM demonstration mode
```

## WSO2 resources

The local standalone runner creates/maintains these resources in the local Gateway Controller:

- Gateway image/build name: `healthcare-ai-security-gateway`
- Provider: `helios-enterprise-openai`
- Clinician App LLM Proxy: `clinical-ai-secure`
- Context: `/default/clinical-ai-secure`
- Patient-support App LLM Proxy: `patient-support-ai-secure`
- Context: `/default/patient-support-ai-secure`

The patient-support application gets a **different inbound key and a different policy chain**. It does not inherit clinician tools or clinician permissions.

Canonical local invocation paths:

```text
POST https://localhost:18443/default/clinical-ai-secure/chat/completions
POST https://localhost:18443/default/patient-support-ai-secure/chat/completions
POST https://localhost:18443/helios-enterprise-openai/chat/completions   Provider key required
```

The App LLM Proxy route used by the demo is `/chat/completions`. WSO2 `request-rewrite` remains the last deployed Gateway stage and performs a full-path rewrite to `/chat/completions` before the Provider hop. The local Provider context is `/helios-enterprise-openai`; its OpenAI upstream base URL is `https://api.openai.com/v1`.

The local custom Gateway build and runner use WSO2 AI Gateway **1.2.0** (`wso2apip-ai-gateway-1.2.0`). The repository also retains a legacy `wso2apip-healthcare-ai-gateway-1.1.0` source tree for historical/reference purposes; it is not the active runtime used by `./run.sh`.

## Agent/tool authority model

In live mode, the model receives OpenAI-compatible function schemas. The model may request a tool, but the BFF remains the execution authority.

Clinician examples:

- `get_patient_summary`
- `get_encounter`
- `get_recent_labs`
- `get_medications`
- `get_allergies`
- `get_conditions`
- `search_clinical_knowledge`
- `check_medication_safety`
- `draft_clinical_note`
- `request_medication_order`
- `request_test_order`
- `submit_for_clinician_approval`

Patient-support tools are intentionally smaller:

- `get_own_appointment`
- `get_own_approved_instructions`
- `search_patient_education`
- `request_callback`

Every tool execution is re-authorized server-side. A model-supplied patient identifier is never trusted as authorization.

## Gateway policy chain

Policy order is security-significant. Each App LLM Proxy has 27 deployed Gateway stages: 5 WSO2-native stages and 22 Helios healthcare-domain custom Go stages. Application/tool authority and human clinical approval remain outside the Gateway-stage count.

1. `api-key-auth` (WSO2 native)
2. `custom-model-allowlist-guardrail` (Helios custom)
3. `custom-resource-budget-guardrail` (Helios custom)
4. `canonicalize-and-classify` (Helios custom)
5. `regex-guardrail` (WSO2 native)
6. `custom-jailbreak-authority-bypass-guardrail` (Helios custom)
7. `custom-request-regex-guardrail` (Helios custom)
8. `custom-request-phi-dlp-guardrail` (Helios custom)
9. `custom-tenant-workforce-context-guard` (Helios custom)
10. `custom-patient-encounter-binding-guard` (Helios custom)
11. `custom-purpose-scope-guard` (Helios custom)
12. `custom-clinical-note-injection-guard` (Helios custom)
13. `custom-sensitive-clinical-context-guard` (Helios custom)
14. `custom-trusted-clinical-source-guard` (Helios custom)
15. `custom-tool-delegation-guard` (Helios custom)
16. `custom-clinical-action-authority-guard` (Helios custom)
17. `custom-clinician-approval-guard` (Helios custom)
18. `custom-prompt-decorator` (Helios custom)
19. `custom-request-block-finalizer` (Helios custom)
20. `custom-response-phi-leakage-guard` (Helios custom)
21. `custom-unsafe-output-guard` (Helios custom)
22. `custom-response-url-guard` (Helios custom)
23. `custom-clinical-reliance-guard` (Helios custom)
24. `custom-structured-clinical-output-guard` (Helios custom)
25. `llm-cost-based-ratelimit` (WSO2 native)
26. `llm-cost` (WSO2 native)
27. `request-rewrite` (WSO2 native); full-path rewrite to /chat/completions

`llm-cost-based-ratelimit` intentionally precedes `llm-cost` in the configured list because response policies execute in reverse. `request-rewrite` remains last.
The BFF does **not** place authorization context in the OpenAI JSON body. It sends a base64url-encoded clinical context in `X-Helios-Clinical-Context` and a server HMAC in `X-Helios-Clinical-Signature`. Context-aware policies verify/use those headers; `custom-prompt-decorator` strips both before the Provider hop. The Gateway therefore never asks the model to carry or authorize its own tenant/patient/role context.

### Native AI governance, FinOps and distributed tracing

The event profile adds WSO2-native Regex Guardrail, LLM cost-based rate limiting and LLM cost accounting to the deployed chain.

The Regex Guardrail performs syntactic Argentina DNI and CUIL/CUIT pattern detection before provider processing. It does not perform identity lookup or DNI/CUIL/CUIT checksum validation.

Clinician AI and Patient AI use separate deliberately small 24-hour operational spending budgets. FinOps exposes calls, input/output/total tokens, average and p95 model latency, configured budget, Gateway-accounted consumption, remaining budget and percentage consumed.

Gateway-accounted operational consumption is explicitly distinguished from the external model-provider invoice.

For model-bound requests, the BFF propagates W3C traceparent into WSO2 AI Gateway. Helios evidence stores the correlated WSO2/OpenTelemetry trace ID only after an actual Gateway invocation and exposes a Jaeger link. Requests stopped before WSO2 do not fabricate a Gateway trace.

## Clinical facts and deterministic safety

Authoritative synthetic patient data is maintained in `healthcare-ai-security-console/server/data/synthetic-healthcare.mjs`. The model cannot authoritatively create an allergy, medication, diagnosis, lab, vital sign, encounter, prescription, order, or test result.

`clinical-safety.mjs` implements **synthetic demo fixtures only** for:

- configured allergy conflicts;
- configured interaction examples;
- configured dose-bound examples;
- required-context checks;
- critical-result/escalation fixtures;
- missing-information abstention.

Fixture identifiers intentionally use synthetic naming. This is not a medical knowledge engine and must not be used for real prescribing safety.

## Purpose-based minimization

The minimization service emits different server-side data views for different purposes. Appointment support does not receive a full chart, while medication review can receive the synthetic medication/allergy context it needs.

This is described as **purpose-based minimization/security**. The project does not claim that the HIPAA minimum-necessary rule applies identically to every treatment disclosure. See `docs/regulatory-mapping.md`.

## Protected clinical knowledge / RAG

The knowledge service distinguishes trusted/versioned clinical knowledge from uploaded/untrusted evidence. It tracks publisher, trust level, dates, version, specialty, tenant, SHA-256, signature state, injection findings, stale state, contradictions, and quarantine state.

The malicious referral fixture remains evidence; embedded instructions are never promoted to clinical authority. Trusted patient facts remain separate from referral text and trusted guidance.

## Break glass

The synthetic break-glass flow requires explicit invocation, step-up, a reason, elevated audit evidence, and expiration. It is never treated as a silent bypass.

## Evidence and observability

Evidence includes trace ID, tenant, workforce actor, role, pseudonymous patient ID, encounter, purpose, scopes, released data categories, model, policy version, trusted sources, safety-service results, requested clinical action, human approval, break-glass state, final decision, and reason codes.

Raw synthetic PHI is still redacted from observability paths. Synthetic data is not an excuse to model unsafe logging practices.

## Scenario laboratory

The repository includes 26 legitimate/adversarial scenarios covering clinical grounding, direct/encoded jailbreaks, malicious referral injection, cross-patient/cross-tenant access, patient-support isolation, over-broad chart retrieval, fabricated facts, deterministic safety conflicts, missing-context abstention, autonomous-order attempts, forged approval, break-glass misuse, stale/poisoned RAG, PHI leakage, unsafe URLs, unsupported certainty, exhaustion, and structured-output failure.

## Tests

Local verification:

```bash
./run.sh test
```

This compiles every custom Go module, validates exact policy order/application binding, runs the Node security/service/scenario tests, checks browser JavaScript syntax, and builds the production frontend.

Live acceptance:

```bash
./run.sh check
```

This requires a previously bootstrapped live WSO2 Gateway and validates:

- separately authenticated Provider -> WSO2 -> OpenAI;
- clinician proxy -> WSO2 -> Provider -> OpenAI;
- adversarial jailbreak denied by the custom Gateway chain;
- lower-privilege patient proxy -> WSO2 -> OpenAI;
- model chooses `get_recent_labs`;
- BFF executes the authoritative patient-data tool;
- the final model response returns through `clinical-ai-secure`.

## AI Workspace / connected deployment

The included local deployment is intentionally standalone so the Gateway can be demonstrated end to end without requiring an AI Workspace tenant. `ai-workspace/README.md` documents the required resource contract for a connected deployment. Do not reuse the local development credentials or `admin/admin` controller authentication in a production environment.

## Production boundaries

This is a reference demonstration, not a production clinical system. Production implementations require organization-specific threat modeling, IAM/IdP integration, secrets management, formal authorization policy, clinical governance, validated knowledge content, medical-device/regulatory analysis where applicable, privacy/legal review, production-grade auditing, monitoring, incident response, data residency/retention controls, security testing, and clinical validation.

See:

- `docs/regulatory-mapping.md`
- `docs/architecture.md`
- `openapi/helios-bff.openapi.yaml`

## Official WSO2 references

- Custom Gateway policies/build: https://wso2.com/api-platform/docs/api-gateway/next/policies/custom-policies/building-gateway-with-custom-policies/
- WSO2 CLI reference: https://wso2.com/api-platform/docs/tools/cli/reference/
- AI Gateway 1.2.0 documentation: https://wso2.com/api-platform/docs/ai-gateway/1.2.0/
