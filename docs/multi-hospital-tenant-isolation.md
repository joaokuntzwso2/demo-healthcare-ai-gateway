# Multi-hospital / tenant isolation

Dr. Mateo Ruiz belongs to Helios North. Helios North and Aurora Saúde intentionally reuse synthetic local MRN `MRN-04217`. The MRN is tenant-scoped, never a global patient key.

The demo enforces the boundary at three layers: application/BFF before foreign identifier resolution, WSO2 AI Gateway using independently signed actor and patient tenant values, and the authoritative tool layer before patient data reads. Break-glass cannot override tenant isolation. Denied audit events use an HMAC-derived MRN fingerprint and do not copy the foreign patient identity or clinical record.

Expected direct-Gateway denial: `custom-tenant-workforce-context-guard` / `TENANT_BOUNDARY_VIOLATION`.

Executive message: **Sharing the AI platform does not mean sharing the clinical trust boundary.**
