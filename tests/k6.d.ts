declare module "k6/http" {
  const http: any;
  export default http;
}

declare module "k6" {
  export const check: any;
  export const sleep: any;
}

declare const __ENV: Record<string, string | undefined>;
