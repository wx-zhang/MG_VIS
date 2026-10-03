import type express from "express";

export function registerApiCorsMiddleware(app: express.Express): void {
  app.use("/api", (req, res, next) => {
    const origin = req.header("Origin");
    const requestedHeaders = req.header("Access-Control-Request-Headers");
    if (origin) {
      // Browser builds can be served from apex/www variants while API traffic lands on the canonical host.
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", requestedHeaders || "Authorization, Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
}
