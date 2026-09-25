# Executive observability dashboard

## Architecture

The demonstration intentionally separates two telemetry planes:

1. **WSO2 native operational metrics**
   - Gateway Controller Prometheus endpoint
   - Policy Engine Prometheus endpoint
   - Envoy Router Prometheus endpoint

2. **Helios semantic AI-governance metrics**
   - allowed / blocked / abstained / review outcomes
   - end-to-end BFF latency
   - real provider-reported input/output/total tokens
   - model calls and agent turns
   - server-authorized tools executed
   - grounding outcome
   - abstention reasons
   - application and WSO2 policy interventions

Prometheus scrapes both planes. Grafana presents the executive operations dashboard.

## Privacy / cardinality contract

Prometheus labels MUST NOT contain:
- patient IDs or pseudonyms
- workforce IDs
- prompts or responses
- trace IDs
- clinical values
- arbitrary free text

Allowed low-cardinality dimensions include:
- application
- professional role
- purpose class
- model / proxy
- tool name
- normalized outcome
- policy name
- reason code

Trace IDs remain in the existing Helios audit/evidence API and the minimized live-governance stream, not in Prometheus labels.

## WSO2 endpoints used by the local demo

The current Helios Docker mappings expose:
- Controller metrics: `http://localhost:9011/metrics`
- Policy Engine metrics: `http://localhost:9003/metrics`
- Envoy metrics: `http://localhost:9901/stats/prometheus`

Helios semantic metrics:
- `http://localhost:5173/metrics`

Prometheus:
- `http://localhost:19090`

Grafana:
- `http://localhost:3000`

## Executive dashboard panels

- total governed requests
- allowed / blocked / abstentions
- p95 end-to-end latency
- model token usage
- request outcomes over time
- latency p50 / p95 / p99
- model usage
- tools called
- grounding outcomes
- policy interventions
- WSO2-specific guardrail interventions
- abstention reasons
- BFF / Controller / Policy Engine / Router health
- analytics drops
- Envoy gateway traffic

## Demo flow

1. Start Helios: `./run.sh`
2. Start observability: `./scripts/start-observability.sh`
3. Generate a representative traffic mix: `node scripts/generate-observability-demo-traffic.mjs`
4. Open Grafana in kiosk mode.
5. Run additional live scenarios in the Helios UI while the VP watches the Grafana panels update.

This is an operating-platform view, not a synthetic static chart: every panel is backed by Prometheus data scraped from the running BFF and WSO2 Gateway.
