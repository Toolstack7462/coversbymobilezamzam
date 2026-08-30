import type { Config } from "@react-router/dev/config";

export default {
  // Server-side rendering is not optional here. Product, collection and search
  // pages must be crawlable and must render their content in the first response;
  // a client-rendered catalogue is both an SEO and a Core Web Vitals problem.
  ssr: true,
} satisfies Config;
