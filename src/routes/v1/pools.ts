import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import {
  GovernanceBoundsError,
  PoolNotFoundError,
  createPool,
  getPool,
  listPools,
  updatePool,
} from "../../services/poolService.js";

const ACTOR = "api:pool-admin";

const createPoolSchema = z.object({
  poolId: z.string().min(1),
  totalCapital: z.number().int().positive(),
  utilisedCapital: z.number().int().nonnegative().optional(),
});

const updatePoolSchema = z.object({
  totalCapital: z.number().int().positive().optional(),
  utilisedCapital: z.number().int().nonnegative().optional(),
});

export const poolRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/pools",
    {
      schema: {
        tags: ["Pools"],
        summary: "Create a pool",
        description: "Public, unauthenticated.",
        body: {
          type: "object",
          required: ["poolId", "totalCapital"],
          properties: {
            poolId: { type: "string", minLength: 1 },
            totalCapital: { type: "integer", minimum: 1 },
            utilisedCapital: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = createPoolSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const pool = await createPool(facilityDeps.prisma, facilityDeps.onChainClient, parsed.data, ACTOR);
        return reply.status(201).send(pool);
      } catch (err) {
        if (err instanceof GovernanceBoundsError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    "/pools",
    {
      schema: {
        tags: ["Pools"],
        summary: "List pools",
        description: "Public, unauthenticated.",
      },
    },
    async () => {
      return listPools(facilityDeps.prisma);
    },
  );

  app.get(
    "/pools/:id",
    {
      schema: {
        tags: ["Pools"],
        summary: "Get a pool by id",
        description: "Public, unauthenticated.",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const pool = await getPool(facilityDeps.prisma, id);
      if (!pool) {
        return reply.status(404).send({ error: "Pool not found" });
      }
      return pool;
    },
  );

  app.patch(
    "/pools/:id",
    {
      schema: {
        tags: ["Pools"],
        summary: "Update a pool",
        description: "Public, unauthenticated.",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            totalCapital: { type: "integer", minimum: 1 },
            utilisedCapital: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updatePoolSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        return await updatePool(facilityDeps.prisma, id, parsed.data, ACTOR);
      } catch (err) {
        if (err instanceof PoolNotFoundError) {
          return reply.status(404).send({ error: err.message });
        }
        if (err instanceof GovernanceBoundsError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};
