# Diffriendtiate App QA Suite

This folder contains app-side testing only. It intentionally avoids `services/`.

## Coverage Areas

- Build & reproducibility: `npm run test:build`
- Unit and component tests: `npm run test:unit`
- API and integration tests: `npm run test:integration`
- Intelligrate app-side reliability: `npm run test:ai`
- Performance smoke tests: `npm run test:performance`
- Security checks: `npm run test:security`
- End-to-end / UAT browser flows: `npm run test:e2e`
- Full evidence run with terminal-log screenshots: `npm run test:evidence`

The evidence runner stores raw logs, summaries, and PNG screenshots of the real
test outputs under `docs/QA_Test_Evidence_<timestamp>/`.

