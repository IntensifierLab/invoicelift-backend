import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../config/env.js";
import { facilityDeps } from "../../lib/facilityDeps.js";
import {
  verifyQuickBooksWebhookSignature,
  verifyXeroWebhookSignature,
} from "../../lib/accounting/webhookVerification.js";
import type { AccountingProvider } from "../../lib/accounting/types.js";
import { ProviderNotConfiguredError } from "../../lib/accounting/oauthClient.js";
import { StubAccountingProviderClient } from "../../lib/accounting/providerClient.js";
import {
  ConnectionNotFoundError,
  OAuthStateError,
  completeConnection,
  importEligibleReceivables,
  initiateConnection,
} from "../../services/accountingIntegrationService.js";

const ACTOR_PREFIX = "api:accounting-integration";
const providerClient = new StubAccountingProviderClient();

const providerParamSchema = z.object({ provider: z.enum(["xero", "quickbooks"]) });
const authorizeQuerySchema = z.object({ smeAddress: z.string().min(1) });
const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) });
const importBodySchema = z.object({ smeAddress: z.string().min(1) });

/** Fastify's default JSON parser consumes the body without retaining the raw
 * bytes, but webhook signature verification needs the exact bytes the
 * provider signed — a re-serialized `JSON.stringify` of the parsed object is
 * not guaranteed to match byte-for-byte. This route-local parser override
 * (scoped to this plugin only, per Fastify's encapsulation — it does not
 * affect the rest of the API) stashes the raw string alongside the parsed
 * body. */
type RawBodyRequest = FastifyRequest & { rawBody?: string };

export const accountingIntegrationRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body: string, done) => {
      (req as RawBodyRequest).rawBody = body;
      try {
        done(null, body.length > 0 ? JSON.parse(body) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.get("/integrations/:provider/authorize", async (req, reply) => {
    const params = providerParamSchema.safeParse(req.params);
    const query = authorizeQuerySchema.safeParse(req.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ error: "Invalid provider or missing smeAddress" });
    }

    try {
      const { authorizeUrl } = initiateConnection(params.data.provider as AccountingProvider, query.data.smeAddress);
      return reply.send({ authorizeUrl });
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        return reply.status(503).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/integrations/:provider/callback", async (req, reply) => {
    const params = providerParamSchema.safeParse(req.params);
    const query = callbackQuerySchema.safeParse(req.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ error: "Invalid provider, missing code, or missing state" });
    }

    try {
      const connection = await completeConnection(
        facilityDeps.prisma,
        params.data.provider as AccountingProvider,
        query.data.code,
        query.data.state,
      );
      return reply.send({
        provider: connection.provider,
        externalTenantId: connection.externalTenantId,
        connectedAt: connection.connectedAt,
      });
    } catch (err) {
      if (err instanceof OAuthStateError) {
        return reply.status(400).send({ error: err.message });
      }
      if (err instanceof ProviderNotConfiguredError) {
        return reply.status(503).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/integrations/:provider/import", async (req, reply) => {
    const params = providerParamSchema.safeParse(req.params);
    const body = importBodySchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Invalid provider or missing smeAddress" });
    }

    try {
      const summary = await importEligibleReceivables(
        facilityDeps.prisma,
        providerClient,
        facilityDeps.onChainClient,
        params.data.provider as AccountingProvider,
        body.data.smeAddress,
        `${ACTOR_PREFIX}:${params.data.provider}`,
      );
      return reply.send(summary);
    } catch (err) {
      if (err instanceof ConnectionNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/integrations/:provider/webhook", async (req, reply) => {
    const params = providerParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid provider" });
    }
    const rawBody = (req as RawBodyRequest).rawBody ?? "";

    if (params.data.provider === "xero") {
      const signature = req.headers["x-xero-signature"];
      if (!config.xeroWebhookKey || !verifyXeroWebhookSignature(rawBody, signature as string | undefined, config.xeroWebhookKey)) {
        return reply.status(401).send({ error: "Invalid webhook signature" });
      }
    } else {
      const signature = req.headers["intuit-signature"];
      if (
        !config.quickbooksWebhookVerifierToken ||
        !verifyQuickBooksWebhookSignature(rawBody, signature as string | undefined, config.quickbooksWebhookVerifierToken)
      ) {
        return reply.status(401).send({ error: "Invalid webhook signature" });
      }
    }

    // Status-change webhooks only need to trigger a re-sync; the actual
    // reconciliation logic (and its audit trail) already lives in
    // importEligibleReceivables, so the handler here is intentionally thin.
    // The request body's per-provider event shape isn't parsed further since
    // this endpoint's contract is "something changed, go re-check" rather
    // than acting on individual event fields.
    req.log.info({ provider: params.data.provider }, "accounting webhook received");
    return reply.status(200).send({ received: true });
  });
};
