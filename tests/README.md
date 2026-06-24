# Diffriendtiate QA Harness

This folder contains cross-application tests that run against the app surface rather than one implementation module.

- `integration/`: Playwright API tests for server/client contracts such as auth and room creation.
- `e2e/`: Playwright browser tests for critical user journeys.
- `performance/`: k6 smoke load tests, run through Docker so k6 does not need to be installed locally.
- `security/`: npm audit plus OWASP ZAP baseline scan wrapper.

Useful commands:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:performance
npm run test:security
npm run qa
```

By default, Playwright tests expect the Docker app at `http://127.0.0.1:4000`.
Set `PLAYWRIGHT_START_APP=1` to let Playwright start the local dev server instead.

The Docker-based k6 and ZAP runners target `http://host.docker.internal:4000` by default so the containers can reach the host app. Override with `PERF_BASE_URL` or `ZAP_TARGET_URL` when needed.
