# Role-based professional differences

Helios demonstrates that an authenticated healthcare workforce identity does not become a universal clinical AI super-user.

## Same scenario

The comparison deliberately holds these attributes constant:

- Patient: Marcus Reed (`pat-1001`)
- Tenant: `helios-north`
- Purpose: `medication-review`
- Question: `Review this patient's current renal function and medication context. What information can you retrieve and what clinical actions, if any, are you permitted to request?`

Only the authenticated professional identity changes.

## Professional responsibility matrix

### Physician
Broad clinical evidence access based on signed scopes. May use approval-bound action-request tools when the signed `clinical-action:request` scope is present. The AI still cannot execute an order and cannot self-approve.

### Clinical pharmacist
Medication, allergy, laboratory, conditions, trusted knowledge and deterministic medication-safety capabilities. No physician medication/test-order request authority and no clinician approval authority.

### Registered nurse
Purpose-authorized clinical summary, encounter, laboratory and allergy review plus draft documentation. No medication-detail capability in this synthetic policy and no physician action-request authority.

### Care manager
Care-summary, encounter, trusted-knowledge, draft coordination documentation and scheduling capabilities. No detailed lab/medication retrieval or clinical order authority.

## Enforcement layers

1. **Model tool exposure** — the tool catalog sent to the model is the intersection of professional-role policy × signed scopes × purpose-of-use.
2. **Pre-model required-evidence gate** — if a clinical question requires a tool outside the role, Helios denies before model invocation instead of forcing an unauthorized tool choice.
3. **Server tool execution** — every requested tool is checked again against professional role.
4. **Action service** — physician action authority is independently checked even if a caller attempts to invoke the action service directly.
5. **WSO2 AI Gateway** — `custom-tool-delegation-guard` independently derives the allowed tool set from signed role + scopes and returns `PROFESSIONAL_ROLE_CAPABILITY_DENIED` for role/tool mismatches.
6. **WSO2 action authority** — `custom-clinical-action-authority-guard` independently rejects non-physician clinical-action intent.

## Scope is necessary but not sufficient

A deliberately important test adds a physician-only scope to a pharmacist or nurse context. The role boundary still denies the physician tool.

Effective capability is:

`professional role ∩ signed scopes ∩ patient relationship ∩ tenant ∩ purpose-of-use -> effective capability`

## Executive message

**The AI inherits professional responsibility boundaries; it does not erase them.**

Physicians, pharmacists, nurses and care managers may work on the same patient and ask the same question, but the AI receives a different tool and action surface for each authenticated professional role.
