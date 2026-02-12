import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "@mercari-bot/core";

function extractClientIp(request: FastifyRequest): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0]?.trim() ?? request.ip;
  }
  return request.ip;
}

export function assertAdminAccess(config: AppConfig, request: FastifyRequest, reply: FastifyReply): boolean {
  const ip = extractClientIp(request);
  if (!config.adminAllowedIps.has(ip)) {
    reply.code(403).send({ error: "Forbidden" });
    return false;
  }

  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing bearer token" });
    return false;
  }

  const token = auth.slice("Bearer ".length);
  if (token !== config.ADMIN_TOKEN) {
    reply.code(401).send({ error: "Invalid bearer token" });
    return false;
  }

  return true;
}
