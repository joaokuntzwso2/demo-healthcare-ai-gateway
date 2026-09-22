# AI Workspace / connected-deployment contract

The default Helios `./run.sh` uses a **local standalone WSO2 AI Gateway Controller + Runtime** so the demo can prove the real Gateway/policy/model/tool path without depending on a cloud tenant.

For a connected WSO2 AI Workspace deployment, preserve these resource identities:

| Resource | Required name/context |
|---|---|
| AI Gateway | `healthcare-ai-security-gateway` |
| LLM Provider | `enterprise-openai` |
| Clinician App LLM Proxy | `clinical-ai-secure` / `/clinical-ai-secure` |
| Patient-support App LLM Proxy | `patient-support-ai-secure` / `/patient-support-ai-secure` |

Apply `../modular-ai-guardrails/config/clinical-policy-chain.json` only to the clinician proxy and `../modular-ai-guardrails/config/patient-support-policy-chain.json` only to the patient-support proxy. Generate separate keys/credentials and keep the patient-support application lower privilege.

Do not copy the local development Controller's `admin/admin` management authentication into production. Use the authentication, registration, secret-management and deployment model required by the target WSO2 environment.


## Invocation and credential boundaries

Keep the same trust split as the banking reference:

- BFF -> clinician/patient App LLM Proxy: separate `X-API-Key` per application.
- App LLM Proxy -> `enterprise-openai`: a distinct Provider `X-API-Key`.
- `enterprise-openai` -> OpenAI: the upstream OpenAI `Authorization` credential.

The App LLM Proxy chat resource is `/v1/chat/completions`; WSO2 `request-rewrite` must remain last and replace the full proxy-relative path with `/chat/completions`.
