import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// // Local Development
// export default defineConfig({
//   plugins: [react()],
//   server: {
//     proxy: {
//       "/api": "http://127.0.0.1:4000",
//       "/uploads": "http://127.0.0.1:4000",
//       "/socket.io": {
//         target: "http://127.0.0.1:4000",
//         ws: true,
//       },
//     },
//   },
// });

// Docker
export default defineConfig({
  plugins: [react()],
});