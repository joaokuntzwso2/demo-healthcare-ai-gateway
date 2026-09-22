# Helios runtime architecture

## Trust and execution boundaries

```text
CLINICIAN / PATIENT UI
        |
        v
NODE BFF -- identity/patient/encounter/purpose binding, minimization, tool authority
        |
        | signed X-Helios-Clinical-Context/X-Helios-Clinical-Signature + separate App LLM Proxy key
        v
WSO2 AI GATEWAY
        |
        +-- api-key-auth
        +-- request/custom clinical security policies
        +-- request-block-finalizer
        +-- custom-prompt-decorator (strips signed internal context headers)
        +-- WSO2 request-rewrite (last; /v1/chat/completions -> /chat/completions)
        |
        v
enterprise-openai (separate Provider X-API-Key boundary) -> OpenAI model
        |
        | tool_call / model response
        v
WSO2 response policies
        |
        v
NODE BFF -- tool execution + deterministic safety + grounding + evidence
        |
        +---- if tool result requires model narration, second WSO2 model turn
        v
UI
```

## Authority model

| Information / action | Authority |
|---|---|
| User/workforce identity | server-side synthetic identity/context service in demo |
| Tenant/patient/encounter binding | server-side context service + signed Gateway context |
| Patient clinical facts | server-side synthetic clinical data service |
| Clinical knowledge | protected versioned knowledge service |
| Uploaded/referral content | evidence only unless separately promoted through trusted workflow |
| LLM text | non-authoritative until validated/grounded |
| Clinical safety fixture result | deterministic demo safety service |
| Medication/test action | server-side action-request workflow + clinician approval |
| Final execution of prescription/order | **not implemented** |

## Live agent sequence

1. The BFF resolves the acting user/application and authorized patient context.
2. It sends the model request to the correct WSO2 App LLM Proxy at `/v1/chat/completions`, using a separate application key plus HMAC-signed internal context headers.
3. Gateway request policies validate the inbound API key, model, resource budget, content, application, signed context, patient/encounter/purpose claims and offered tools.
4. `custom-prompt-decorator` strips the Helios-only authority headers, then the final WSO2 `request-rewrite` changes `/v1/chat/completions` to `/chat/completions`. The proxy authenticates separately to `enterprise-openai` using a generated Provider access key.
5. The model can return an OpenAI-compatible `tool_call`.
6. The BFF validates that the requested tool belongs to that application and revalidates its parameters against authorized patient/tenant/encounter/scope.
7. The server-side tool retrieves authoritative synthetic data or invokes the deterministic safety/action service.
8. The tool result is returned to the model through the same WSO2 proxy for final narrative generation.
9. Response policies and BFF grounding/output validation prevent model text from silently becoming an authoritative fact or action.
10. A redacted evidence trace records the decision path.

## Local ports

- 5173: Helios UI/BFF
- 8443: WSO2 HTTPS Gateway ingress
- 8080: WSO2 HTTP ingress
- 9090: WSO2 Controller management API
- 9094: mapped Controller admin/health
- 9901: Runtime readiness/admin

## Development-mode warning

The local Controller uses development-mode/basic administration for a reproducible customer demonstration. That is not a production authentication model. Production deployments need an enterprise IdP, secrets manager, hardened TLS/certificate lifecycle, restricted management interfaces and environment-specific controls.
