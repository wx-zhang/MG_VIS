import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ["maplibre-gl"] },
  build: {
    rollupOptions: {
      output: {
        // 禁止 manual chunk 递归吸收 React 等共享依赖，否则普通首屏会反向依赖并预加载 3D chunk。
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          // Three 的发布频率低于页面代码，独立 content hash 可跨 Workspace UI 发布复用浏览器缓存。
          if (id.includes("/node_modules/three/")) return "three-engine";
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5178,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/internal": "http://127.0.0.1:3001",
      "/socket.io": {
        target: "ws://127.0.0.1:3001",
        ws: true
      },
      "/daemon": {
        target: "ws://127.0.0.1:3001",
        ws: true
      }
    }
  }
});
