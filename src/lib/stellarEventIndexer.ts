import { config } from "../config/env.js";

export interface ContractEvent {
  contractId: string;
  ledger: number;
  txHash: string;
  topic: string;
  data: unknown;
}

export interface EventSource {
  /** Returns every event at or after `sinceLedger`, ordered by ledger ascending. */
  fetchEvents(sinceLedger: number): Promise<ContractEvent[]>;
}

/**
 * Deterministic, empty-by-default source so the indexer is runnable and
 * testable without a live Soroban RPC connection. Tests inject events via
 * the constructor rather than this class doing anything dynamic.
 */
export class StubEventSource implements EventSource {
  constructor(private readonly events: ContractEvent[] = []) {}

  async fetchEvents(sinceLedger: number): Promise<ContractEvent[]> {
    return this.events.filter((e) => e.ledger >= sinceLedger).sort((a, b) => a.ledger - b.ledger);
  }
}

export class SorobanEventSource implements EventSource {
  async fetchEvents(): Promise<ContractEvent[]> {
    throw new Error(
      "SorobanEventSource is not implemented yet — set STELLAR_EVENT_SOURCE_MODE=stub, or implement Soroban RPC getEvents integration before enabling this mode.",
    );
  }
}

export function createEventSource(): EventSource {
  switch (config.stellarEventSourceMode) {
    case "soroban":
      return new SorobanEventSource();
    case "stub":
    default:
      return new StubEventSource();
  }
}

/** Where the indexer's last-processed ledger is persisted between polls. */
export interface IndexerCheckpointStore {
  getLastLedger(): Promise<number>;
  setLastLedger(ledger: number): Promise<void>;
}

/**
 * Process-lifetime-only checkpoint. Fine for a single-instance deployment;
 * swap for a DB-backed IndexerCheckpointStore (same interface) once the
 * indexer needs to survive restarts or run across multiple instances.
 */
export class InMemoryCheckpointStore implements IndexerCheckpointStore {
  private lastLedger = 0;

  async getLastLedger(): Promise<number> {
    return this.lastLedger;
  }

  async setLastLedger(ledger: number): Promise<void> {
    this.lastLedger = ledger;
  }
}

export type ContractEventHandler = (event: ContractEvent) => Promise<void>;

/**
 * Polls an EventSource for InvoiceLift contract events since the last
 * checkpoint and dispatches each to every handler registered for its
 * contractId, advancing the checkpoint only after the whole batch succeeds
 * so a mid-batch failure re-delivers the batch on the next poll rather than
 * silently skipping events — handlers must be idempotent for this reason.
 */
export class StellarEventIndexer {
  private readonly handlers = new Map<string, ContractEventHandler[]>();

  constructor(
    private readonly source: EventSource,
    private readonly checkpoints: IndexerCheckpointStore,
  ) {}

  onEvent(contractId: string, handler: ContractEventHandler): void {
    const existing = this.handlers.get(contractId) ?? [];
    existing.push(handler);
    this.handlers.set(contractId, existing);
  }

  /** Fetches and dispatches one batch of new events; returns how many were processed. */
  async poll(): Promise<number> {
    const sinceLedger = await this.checkpoints.getLastLedger();
    const events = await this.source.fetchEvents(sinceLedger + 1);

    for (const event of events) {
      const contractHandlers = this.handlers.get(event.contractId) ?? [];
      for (const handler of contractHandlers) {
        await handler(event);
      }
    }

    if (events.length > 0) {
      const maxLedger = Math.max(...events.map((e) => e.ledger));
      await this.checkpoints.setLastLedger(maxLedger);
    }

    return events.length;
  }
}
