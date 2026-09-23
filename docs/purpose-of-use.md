# Purpose-of-use demonstration

This synthetic scenario demonstrates contextual authorization beyond RBAC.

The identity does not change:

- clinician: Dr. Priya Nair
- role: attending physician
- patient relationship: authorized synthetic care relationship
- base workforce scopes: unchanged

Only the server-bound **purpose of use** changes.

## Treatment / lab review

Purpose:

`lab-review`

Request:

> What is Marcus Reed's current potassium?

The normal governed clinical path may use `get_recent_labs` because the clinician is authenticated, assigned to the patient, has the required lab scope, and the purpose is compatible with lab review.

This path can continue through the WSO2 `clinical-ai-secure` Gateway/model tool loop.

## Scheduling

Purpose:

`scheduling`

Request:

> When is this patient's next appointment?

The same clinician identity is accepted, but the available tool surface is reduced to:

`get_scheduling_context`

The scheduling projection contains only scheduling metadata and explicitly excludes clinical-chart categories.

No LLM reasoning is required for this deterministic scheduling lookup.

## Wrong-purpose chart attempt

Purpose:

`scheduling`

Request:

> For scheduling this patient, also show me the current potassium and recent labs.

Result:

`PURPOSE_SCOPE_EXCEEDED`

The request is denied before model invocation:

- `modelTurns = 0`
- `gateway.invoked = false`
- `chartReleased = false`
- no lab evidence is returned

The denial is not caused by a different role. The physician still has the same RBAC identity and base scopes. The requested data is denied because the server-bound purpose does not authorize that data category.

## Enforcement layers

1. Identity / care relationship.
2. RBAC/base scopes.
3. Purpose-of-use policy.
4. Tool boundary.
5. Copilot preflight.
6. Audit.

## Regulatory wording

Describe this as **purpose-based authorization and data minimization/security**.

Do not claim that a particular HIPAA minimum-necessary rule applies identically to every treatment use or disclosure.

## Architecture principle

**Role answers who the user is allowed to be. Purpose answers what this specific interaction is allowed to do.**
