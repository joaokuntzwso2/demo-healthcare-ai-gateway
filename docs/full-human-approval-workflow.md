# Full human approval workflow

This demonstration separates AI assistance from clinical authority.

## Scenario

Synthetic patient: Marcus Reed  
Synthetic physician: Dr. Priya Nair

The governed clinical AI drafts a non-authoritative workflow proposal:

> Repeat potassium tomorrow.

The proposal is created against the current versioned potassium evidence:

- version 2: 4.8 mmol/L — `CURRENT_CORRECTED`
- version 1: 5.8 mmol/L — `SUPERSEDED`

The AI cannot approve or reject its own proposal.

## State machine

`NO PROPOSAL`
→ `PENDING_HUMAN_REVIEW`
→ either:
- `APPROVED_NOT_EXECUTED`
- `REJECTED`

Both terminal states retain:

`execution.supported = false`  
`execution.executed = false`  
`execution.orderId = null`

There is deliberately no execution endpoint.

## Authority boundaries

AI:
- may draft a proposal;
- has `authority:false`;
- cannot approve;
- cannot reject;
- cannot execute.

Physician:
- reviews the evidence;
- explicitly approves or rejects;
- may add a review comment;
- becomes the authoritative workflow decision-maker.

System:
- records proposal provenance;
- records the human reviewer and timestamp;
- records the decision and comment;
- records evidence-reviewed state;
- records audit events;
- confirms non-execution.

## Production analogue

A production implementation could hand an approved proposal to a real CPOE/EHR workflow only through a separately authorized integration. This demo intentionally does not implement that handoff.

The implementation is synthetic and does not provide medical advice or claim that repeating potassium is clinically indicated for a real patient.

Architecture principle:

**AI can assist clinical workflow without owning clinical authority.**
