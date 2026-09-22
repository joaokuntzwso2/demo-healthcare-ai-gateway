# Helios UI storytelling refactor

This package intentionally changes only the presentation/BFF surface.

## What changes

- Five-screen live-demo navigation: Demo Journey, Clinician AI, Patient AI, Guardrails, Evidence.
- New light clinical visual system: deep navy, healthcare teal, WSO2 orange accent, violet patient context, red policy intervention.
- Removes presentation UI dependencies on direct fixture/reference APIs.
- Direct `/api/overview`, `/api/scenarios`, `/api/knowledge`, `/api/knowledge/ingest`, and `/api/reference-data` access returns HTTP 410 from the presentation server.
- Clinician and patient experiences use `/api/copilot` and `/api/patient-support` only.
- New `/api/demo/guardrail-probe` performs a signed direct Gateway probe through the existing application proxy/key and is used only to demonstrate Gateway-layer enforcement separately from BFF inspection.
- Evidence page displays runtime policy state and real traces produced by governed requests.
- `docs/demo-story.md` provides a 7–10 minute presenter flow.

## What this package does not touch

- `run.sh`
- `.openai.env`, `.helios.env`, `api-platform.env`
- WSO2 1.2 Docker/Gateway configuration
- bootstrap/key rotation scripts
- policy-chain JSON
- Go policy implementations
- the patient/clinician security hotfixes already applied

After extraction, run `./run.sh`. The existing build step will rebuild `healthcare-ai-security-console/dist` from the updated `public` files.
