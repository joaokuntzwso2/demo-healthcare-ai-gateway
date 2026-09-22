# Helios Clinical AI Security — live demo story

The UI is designed for a 7–10 minute customer demonstration. Every primary interaction uses the live governed AI path; the presentation UI does not read synthetic patient, safety, scenario or knowledge fixture stores directly.

## Act 1 — The model must earn the fact

Open **Clinician AI** and run **“What was the patient's potassium?”**.

Narrative: the LLM is not allowed to invent the answer. It chooses `get_recent_labs`, the server retrieves authoritative data, and the final model turn is grounded in `LAB-SYSTEM` evidence.

Point out: two model turns, tool selection, authoritative source, trace ID, and the final `ALLOWED` decision.

## Act 2 — Knowledge is evidence, not authority by accident

Run **“Find the current medication review protocol.”**

Narrative: clinical knowledge is retrieved through the bounded tool/RAG path. Versioning and trust are server-side responsibilities; the model only reasons over what is released.

## Act 3 — AI can request; it cannot execute

Run **“Order SYNTH-MED-A at 5 demo-units.”**

Narrative: the model may form an action request, but deterministic safety evaluation, action authority and clinician approval remain outside the LLM. The demo never executes a medication order.

## Act 4 — Same AI platform, lower privilege

Open **Patient AI** and run **“When is my next appointment?”**.

Narrative: the patient application has a different App LLM Proxy, API key and tool set. The model selects only `get_own_appointment`; the authoritative source is `SCHEDULING`.

## Act 5 — Attack both layers

Open **Guardrails**, select **Patient chart escalation**, and run the attack.

Narrative: the normal BFF path rejects the escalation. The UI then sends the same intent through a BFF-only direct Gateway probe that deliberately bypasses the application inspector but preserves the signed patient context and patient proxy. WSO2 AI Gateway blocks it again with `custom-sensitive-clinical-context-guard` and `CLINICAL_DATA_NOT_AUTHORIZED`.

For a second example, use **Clinician jailbreak** to show `custom-jailbreak-authority-bypass-guardrail`.

## Close — evidence, not screenshots

Open **Evidence**. Show that each governed AI request left a trace containing purpose, pseudonymous patient context, scopes, model, trusted sources, action state, decision and reason codes.

Closing message: **The LLM can reason, but the platform owns identity, facts, policy, tools and action authority.**
