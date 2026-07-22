import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pool = await prisma.pool.upsert({
    where: { poolId: "pool-demo-1" },
    update: {},
    create: {
      poolId: "pool-demo-1",
      totalCapital: 1_000_000_00,
      utilisedCapital: 950_000_00,
    },
  });

  await prisma.treaty.create({
    data: {
      poolId: pool.poolId,
      reinsurerName: "Demo Re",
      facilityLimit: 500_000_00,
      triggerThreshold: 0.9,
      costBps: 250,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
