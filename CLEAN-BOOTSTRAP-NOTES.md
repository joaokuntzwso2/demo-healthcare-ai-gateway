# Helios clean bootstrap update

After overlaying these files into the repository:

1. Ensure `wso2apip-ai-gateway-1.2.0/api-platform.env` and the 1.2.0 Docker Compose files already exist from the one-time WSO2 setup.
2. Run `./run.sh`.
3. On the first run, enter the OpenAI API key once. It is saved only in `.openai.env` (git-ignored).
4. Every subsequent `./run.sh` destructively resets Helios application state: all LLM proxies are deleted; all `enterprise-openai` consumer keys are revoked; non-OpenAI LLM providers are removed; `enterprise-openai` is reconfigured from `.openai.env`; clinician/patient proxies and keys are recreated; Helios secrets and runtime env files are regenerated; acceptance tests must pass before the UI starts.
5. Gateway registration (`api-platform.env` and Compose setup) is infrastructure and is intentionally preserved.
