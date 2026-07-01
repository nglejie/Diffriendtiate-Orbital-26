import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: Number(__ENV.PERF_VUS || 5),
  duration: __ENV.PERF_DURATION || "20s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

export default function () {
  const baseURL = __ENV.PERF_BASE_URL || "http://host.docker.internal:4000";
  const health = http.get(`${baseURL}/api/health`);
  const app = http.get(`${baseURL}/`);

  check(health, {
    "health status is 200": (response) => response.status === 200,
    "health payload is app API": (response) =>
      String(response.body || "").includes("Diffriendtiate API"),
  });
  check(app, {
    "app shell status is 200": (response) => response.status === 200,
    "app shell contains root": (response) => String(response.body || "").includes("root"),
  });

  sleep(1);
}
