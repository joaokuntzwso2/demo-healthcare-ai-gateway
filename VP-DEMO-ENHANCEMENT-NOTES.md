# Helios VP Demo Enhancement

This overlay upgrades the presentation layer and synthetic healthcare domain without changing WSO2 Gateway bootstrap/runtime code or Go policy implementations.

## What changes

- Multi-organization, multi-clinician, multi-patient synthetic healthcare domain.
- Longitudinal lab histories and distinct care journeys.
- VP-oriented Executive Demo page with guided stories.
- Clinician and patient persona/case selectors that expose presentation metadata only.
- Exact 24-policy catalog aligned to the clinician policy-chain configuration.
- Realistic healthcare questions and risk scenarios for every policy.
- Live vs walkthrough classification for policy demonstrations.
- Broader AI evidence/tool routing for renal, diabetes, anticoagulation, cardiac, respiratory and anemia workflows.
- Additional trusted demonstration playbooks for protected RAG.

## Security architecture preserved

The browser does not receive raw clinical fixture records. The `/api/demo/catalog` endpoint contains presentation metadata only. Clinical facts remain server-side and are released through governed tools and the WSO2 AI Gateway flow.

The direct fixture presentation APIs remain disabled.

## Apply

From the repository root:

```bash
unzip -o ~/Downloads/helios-vp-demo-enhancement.zip -d .
./run.sh
```

No forced Gateway image rebuild is needed for this overlay because it does not modify Go policy code.

## Validation

Targeted validation completed successfully:

- 51/51 routing, security, scenario, UI-contract and VP-demo tests passed.
- Production frontend build passed.
- Policy catalog contract matches the exact 24-stage clinician chain and order.
