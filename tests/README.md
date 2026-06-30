# Diffriendtiate QA Suite

This is the single root-level test suite for Diffriendtiate. It covers the app
surface across frontend, backend, integration, Intelligrate orchestration, smoke
performance, security, and browser UAT flows. Tests intentionally avoid editing
or depending on `services/` internals.

## Why Root-Level

The suite lives at the repository root because it validates behavior across both
`apps/client` and `apps/server`. Keeping these cross-cutting checks in one
top-level `tests/` directory makes the local commands and GitHub Actions job
match each other, while still allowing individual folders to target unit,
integration, AI reliability, performance, security, and browser UAT concerns.

## Coverage Areas

- Build & reproducibility: `npm run test:build`
- Unit and component tests: `npm run test:unit`
- API and integration tests: `npm run test:integration`
- Intelligrate app-side reliability: `npm run test:ai`
- Performance smoke tests: `npm run test:performance`
- Security checks: `npm run test:security`
- End-to-end / UAT browser flows: `npm run test:e2e`
- Full local QA gate: `npm test`
- Full QA gate plus production build check: `npm run qa`
- Evidence run with terminal-log screenshots: `npm run test:evidence`

## Layout

- `unit/`: pure helper and business-logic tests.
- `components/`: React component tests using jsdom and Testing Library.
- `integration/`: real app API tests with isolated storage and a mock
  Intelligrate service.
- `ai/`: app-side Intelligrate reliability and corpus-sync tests.
- `performance/`: fast smoke budgets plus optional k6 wrapper.
- `security/`: dependency audit, authorization, private-room, error hygiene, and
  source-pattern checks.
- `e2e/`: browser UAT flows using Playwright.
- `helpers/`, `setup/`, and `scripts/`: shared fixtures, test servers, and
  evidence generation utilities.

The evidence runner stores raw logs, summaries, and PNG screenshots of real test
outputs under `docs/QA_Test_Evidence_<timestamp>/`.
