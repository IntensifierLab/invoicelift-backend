import { describe, expect, it } from "vitest";
import {
  InMemoryCheckpointStore,
  StellarEventIndexer,
  StubEventSource,
  type ContractEvent,
} from "../../src/lib/stellarEventIndexer.js";

function event(partial: Partial<ContractEvent> & { ledger: number }): ContractEvent {
  return {
    contractId: "CINVOICELIFT",
    txHash: `tx-${partial.ledger}`,
    topic: "invoice_verified",
    data: {},
    ...partial,
  };
}

describe("StellarEventIndexer", () => {
  it("dispatches events since the checkpoint to handlers registered for that contractId", async () => {
    const events = [event({ ledger: 1 }), event({ ledger: 2 })];
    const indexer = new StellarEventIndexer(new StubEventSource(events), new InMemoryCheckpointStore());

    const seen: ContractEvent[] = [];
    indexer.onEvent("CINVOICELIFT", async (e) => {
      seen.push(e);
    });

    const count = await indexer.poll();

    expect(count).toBe(2);
    expect(seen.map((e) => e.ledger)).toEqual([1, 2]);
  });

  it("does not re-deliver events already covered by the checkpoint", async () => {
    const events = [event({ ledger: 1 }), event({ ledger: 2 })];
    const checkpoints = new InMemoryCheckpointStore();
    const indexer = new StellarEventIndexer(new StubEventSource(events), checkpoints);

    let calls = 0;
    indexer.onEvent("CINVOICELIFT", async () => {
      calls++;
    });

    await indexer.poll();
    const secondBatch = await indexer.poll();

    expect(secondBatch).toBe(0);
    expect(calls).toBe(2);
  });

  it("picks up newly-arrived events on a later poll without re-delivering earlier ones", async () => {
    const source = new StubEventSource([event({ ledger: 1 })]);
    const checkpoints = new InMemoryCheckpointStore();
    const indexer = new StellarEventIndexer(source, checkpoints);

    const seen: number[] = [];
    indexer.onEvent("CINVOICELIFT", async (e) => {
      seen.push(e.ledger);
    });

    await indexer.poll();

    const laterSource = new StubEventSource([event({ ledger: 1 }), event({ ledger: 5 })]);
    const laterIndexer = new StellarEventIndexer(laterSource, checkpoints);
    laterIndexer.onEvent("CINVOICELIFT", async (e) => {
      seen.push(e.ledger);
    });
    await laterIndexer.poll();

    expect(seen).toEqual([1, 5]);
  });

  it("only dispatches to handlers registered for the matching contractId", async () => {
    const events = [event({ ledger: 1, contractId: "OTHER" })];
    const indexer = new StellarEventIndexer(new StubEventSource(events), new InMemoryCheckpointStore());

    let called = false;
    indexer.onEvent("CINVOICELIFT", async () => {
      called = true;
    });

    await indexer.poll();

    expect(called).toBe(false);
  });

  it("does not advance the checkpoint when no events are returned", async () => {
    const checkpoints = new InMemoryCheckpointStore();
    const indexer = new StellarEventIndexer(new StubEventSource([]), checkpoints);

    await indexer.poll();

    expect(await checkpoints.getLastLedger()).toBe(0);
  });

  it("supports multiple handlers on the same contractId, all invoked", async () => {
    const events = [event({ ledger: 1 })];
    const indexer = new StellarEventIndexer(new StubEventSource(events), new InMemoryCheckpointStore());

    let a = false;
    let b = false;
    indexer.onEvent("CINVOICELIFT", async () => {
      a = true;
    });
    indexer.onEvent("CINVOICELIFT", async () => {
      b = true;
    });

    await indexer.poll();

    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});
