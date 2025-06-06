import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8080),
  API_PREFIX: z.string().default("/api/v1"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

const raw = schema.parse(process.env);

export const config = {
  nodeEnv: raw.NODE_ENV,
  port: raw.PORT,
  apiPrefix: raw.API_PREFIX,
  corsOrigin: raw.CORS_ORIGIN,
};

// Contribution check by johndoedev at 2024-11-08T05:55:51

// Contribution check by nancy-k at 2025-02-12T11:26:53

// Contribution check by oluwagbemiga at 2025-05-19T16:57:55

// Contribution check by johndoedev at 2025-08-23T22:28:57

// Contribution check by nancy-k at 2025-11-28T03:59:59

// Contribution check by oluwagbemiga at 2026-03-04T09:31:02

// Contribution check by johndoedev at 2026-06-08T15:02:04

// Contribution by CelestinaBeing — 2024-11-05

// Contribution by joelpeace48-cell — 2024-12-28

// Contribution by Williams-1604 — 2025-02-19

// Contribution by codemagician1949 — 2025-04-14

// Contribution by WIAG1949 — 2025-06-06
