# Regulatory and assurance mapping

**Purpose:** architecture/security mapping for a synthetic demonstration.
**Last reviewed:** 2026-09-17.
**Status:** informational; not legal, regulatory, medical, privacy, or certification advice.

Helios demonstrates technical patterns that can support governance. It does **not** establish compliance, clearance, certification, registration, clinical safety, or fitness for a real healthcare use case.

| Foundation | Jurisdiction / status reviewed | Relevant concept | Helios mapping | Explicit limitation |
|---|---|---|---|---|
| OWASP Top 10 for LLM Applications 2025 | Global community guidance; 2025 release | prompt injection, sensitive information disclosure, supply-chain/data poisoning, improper output handling, excessive agency and related GenAI risks | canonicalization, jailbreak/injection controls, DLP, protected RAG, tool/delegation guard, action authority, output checks | OWASP guidance is not a compliance certification and the demo controls are not a substitute for threat modeling/testing |
| NIST AI RMF 1.0 | United States; voluntary framework published 2023; NIST notes 1.0 is being revised in 2026 | Govern/Map/Measure/Manage risk-management lifecycle and trustworthy AI characteristics | explicit authority boundaries, traceability, scenario testing, policy versions, safety-service results, human approval, production-boundary documentation | mapping does not mean NIST conformance or assurance |
| NIST AI 600-1 GenAI Profile | United States; voluntary profile published 2024, updated by NIST page in 2026 | GenAI-specific risk management across lifecycle | injection, information integrity, human oversight, provenance, RAG/supply-chain and monitoring controls | profile is cross-sectoral and must be tailored to the actual healthcare deployment |
| ISO/IEC 42001:2023 | International; published management-system standard | organization-wide AI management system, governance, responsibilities and continual improvement | evidence model, policy/version visibility, explicit production recommendations, separations of authority | the repository is not an AIMS and is not ISO/IEC 42001 certified |
| HIPAA Privacy Rule | United States; rule applicability depends on entity, role, data and activity | permitted uses/disclosures, role-based access, minimum-necessary rule and exceptions | purpose-bound views and data minimization are security/privacy design patterns | **Do not equate Helios purpose minimization with the HIPAA minimum-necessary standard.** HHS states that disclosures to or requests by a healthcare provider for treatment purposes are exempt from the minimum-necessary requirement; internal access/use still requires appropriate role-based policies and the exact rule must be analyzed for the real workflow |
| HIPAA Security Rule | United States; current rule plus separate proposed strengthening activity | access control, audit controls, integrity, person/entity authentication, transmission security for ePHI | role/scope checks, signed context, trace evidence, TLS Gateway ingress, integrity/provenance fields, redacted observability | synthetic demo architecture does not establish HIPAA Security Rule compliance; risk analysis and regulated-entity safeguards are organization-specific |
| FDA Clinical Decision Support Software Guidance | United States; **Final guidance January 2026** | criteria for certain non-device CDS vs software functions that remain devices; ability for healthcare professional to independently review basis is one part of statutory analysis | trusted sources/provenance, fact grounding, human approval, explicit non-autonomous framing | Helios is not FDA-cleared. Human review alone does **not** automatically make software non-device CDS. Intended use, function, users and all applicable statutory criteria must be assessed. Patient/caregiver functions may still be device functions |
| LGPD (Lei 13.709/2018) | Brazil; federal data-protection law | health data is sensitive personal data; purpose, necessity, security and applicable legal bases/safeguards matter | synthetic-only data, tenant/context boundaries, purpose views, DLP, pseudonymous trace identifiers | demo use of synthetic data does not establish LGPD compliance; real processing needs controller/operator, legal-basis, data-subject, security, sharing, transfer and sector-specific analysis |
| Anvisa RDC 657/2022 + Anvisa SaMD Q&A | Brazil; RDC addresses regularization of Software as a Medical Device; official Q&A published 2022 | whether software is SaMD and its regularization/classification depend on intended use and function | demo explicitly avoids claiming diagnosis/prescribing authority and labels fixtures demonstrative | Helios is **not** registered/notified with Anvisa and is not represented as SaMD. A real product requires current intended-use/classification assessment against Anvisa rules and guidance |
| HL7 FHIR R5 Security & Privacy guidance | International interoperability standard; R5 current published specification page reviewed | authorization/access context, audit/provenance, signatures, secure transport, privacy/security building blocks | FHIR-inspired synthetic resource shapes, provenance/trust metadata, TLS, audit/evidence, context binding | FHIR does not itself provide a complete security protocol; this demo is FHIR-inspired and does not claim full FHIR conformance |

## HIPAA minimum-necessary nuance

The project deliberately uses the label **purpose-based minimization/security** for its architecture. HHS guidance says the minimum-necessary standard generally requires reasonable limitation of PHI when it applies, but explicitly identifies exceptions. In particular, disclosures to or requests by a healthcare provider for treatment purposes are exempt from the minimum-necessary requirement. HHS also describes role-based internal access controls and distinguishes internal uses from certain treatment disclosures/requests. Therefore this demo does not state that every treatment-related access must be technically minimized under the same HIPAA rule.

## FDA/CDS nuance

The FDA's January 2026 final CDS guidance clarifies its interpretation of the statutory non-device CDS criteria and provides device/non-device examples. Helios intentionally exposes source provenance, authoritative-fact boundaries and clinician approval, but these features are **not a regulatory shortcut**. Whether a real function is a device turns on the actual intended use and statutory/regulatory criteria, not simply the presence of a human reviewer.

## Brazilian health-data/SaMD nuance

LGPD Article 5 classifies data concerning health as sensitive personal data. Anvisa RDC 657/2022 addresses software-as-medical-device regularization. A production Brazilian deployment therefore needs separate privacy/data-protection analysis and medical-device intended-use/classification analysis; one does not substitute for the other.

## Official sources reviewed

- OWASP Top 10 for LLM Applications 2025: https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/
- NIST AI RMF 1.0: https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10
- NIST AI RMF / revision status: https://www.nist.gov/itl/ai-risk-management-framework
- NIST AI 600-1 GenAI Profile: https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
- ISO/IEC 42001:2023: https://www.iso.org/standard/42001
- HHS HIPAA Security Rule summary: https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html
- HHS Minimum Necessary Requirement: https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/minimum-necessary-requirement/index.html
- HHS treatment/payment/operations guidance: https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/disclosures-treatment-payment-health-care-operations/index.html
- FDA Clinical Decision Support Software, Final Guidance, January 2026: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software
- LGPD consolidated law: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- ANPD glossary: https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/glossario-anpd
- Anvisa RDC 657/2022 SaMD Q&A: https://www.gov.br/anvisa/pt-br/centraisdeconteudo/publicacoes/produtos-para-a-saude/manuais/software-como-dispositivo-medico-perguntas-e-respostas
- HL7 FHIR R5 Security & Privacy module: https://www.hl7.org/fhir/secpriv-module.html
