# Break-glass emergency access

This demonstration models an exceptional access path for emergency care.

## Story

Dr. Maya Patel (`er-001`) is a synthetic Emergency Medicine physician in the Helios North tenant. She is intentionally **not** assigned to Marcus Reed (`pat-1001`).

Normal patient-context authorization therefore denies access with `BREAK_GLASS_REQUIRED`.

The emergency workflow is explicit:

1. The clinician enters a meaningful emergency-access reason.
2. Helios creates a pending break-glass request and requires step-up authentication.
3. The demo performs a synthetic WebAuthn verification. This is a deterministic demo fixture, not a real authenticator.
4. A temporary grant is issued for 10 minutes by default, capped at 15 minutes.
5. During the grant window, the BFF/domain authorization layer permits the emergency physician to use authorized patient tools without creating a permanent care-team assignment.
6. Every request, step-up result, grant, use, revocation and expiry is written to a dedicated `HIGH` severity audit stream.
7. The audit uses the patient pseudonym rather than the raw internal patient ID.

## Important boundary

Break-glass does **not** silently bypass tenant binding, workforce identity, purpose/scopes, tool authorization, model guardrails, clinical-action controls or clinician approval.

It only substitutes a short-lived exceptional patient relationship for the normal care-team relationship.

The WSO2 AI Gateway continues to receive a minimized signed break-glass context, but this reference patch does not make the Gateway independently resolve the hospital's emergency relationship authority. The authoritative grant is maintained by the BFF/domain layer.

In a production design, step-up would come from the enterprise IdP / WSO2 Identity Server or another identity provider and should be bound to strong authentication evidence (`acr` / `amr` or equivalent), the clinician identity, patient context, reason, grant lifetime and audit correlation.

The synthetic workflow is not a statement of a universal legal rule or hospital policy. Emergency-access policy, permitted data, duration, notification, review and retrospective attestation must be configured for the institution and jurisdiction.
