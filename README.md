# InvoiceLift — Backend API (Stellar / Soroban integration)

Invoice financing connects lenders, SMEs, and anchor buyers—this API runs the secure workflows that wallets alone cannot: underwriting hooks, pool administration, and repayment reconciliation.

---

## 🎯 What is this service?

InvoiceLift’s **`invoice-registry`**, **`pool-manager`**, and **`repayment-waterfall`** contracts enforce **who is owed what** on-chain. Banks and fintechs still run credit committees, KYB, and ERP connectors—this backend exposes **those** integrations: signed webhooks when buyers approve invoices, batch drawdown submissions, delinquency workflows, and waterfall settlement jobs matched to actual bank rails.

---

## ❓ Problems the **protocol** solves (whole repo)

These come from the [root README](../../README.md) — shared context for why Stellar/Soroban exists here:

- SMEs face chronic **cash-flow gaps** even when buyers are creditworthy.
- Invoice financing is often expensive or unavailable due to **information asymmetry**.
- Repayments from buyers need **clear priority rules** among lenders, fees, and penalties.

---

## 🛠️ Problems **this API** solves specifically

The smart contracts hold **truth on-chain**; they cannot safely hold ERP passwords, IoT vendor keys, bulk files, or cron jobs. That is this service’s job:

- **KYB & legal docs**: Sensitive borrower files cannot transit through client-only SPAs.
- **ERP connectors**: Anchor enterprises POST invoice acknowledgements server-to-server.
- **Waterfall complexity**: Multi-party repayment splitting often needs server reconciliation vs raw wallet UX.
- **Regulatory reporting**: Pool concentration exports for jurisdictions.

---

## ✅ Protocol goals this backend helps achieve

- Register invoices and state transitions in `invoice-registry` (verify, assign, default handling).
- Allow **pools** with exposure limits in `pool-manager`.
- Route repayments through `repayment-waterfall` with **predictable** precedence.
- Provide monitoring surfaces for **underwriting** and portfolio risk.

---

## 💡 Capabilities this backend enables (production roadmap)

- **Drawdown pipeline**: Validate invoices off-chain then mint financing positions on-chain.
- **Pool admin APIs**: Capital calls, exposure dashboards, investor notices.
- **Repayment ingestion**: Bank settlement files → waterfall execution proposals.
- **Credit hooks**: Integrate external scoring providers behind contracts.

---

## 🔗 Soroban crates → API responsibilities

| Crate | What the HTTP layer typically does |
| ----- | ---------------------------------- |
| `invoice-registry` | Verify invoice authenticity signals from buyers; transition states with evidence URIs. |
| `pool-manager` | Allocate capital respecting concentration limits; LP onboarding workflows. |
| `repayment-waterfall` | Apply inbound cash to precedence rules; generate surplus/deficit alerts. |

---

## 🏗️ Architecture & stack

| Layer | Choice |
| ----- | ------ |
| HTTP framework | **Fastify** 5 — low overhead, schema-friendly |
| Language | **TypeScript** (strict, ESM, `verbatimModuleSyntax`) |
| Config | **Zod** parsing in `src/config/env.ts` |
| Blockchain | **Stellar** Horizon + **Soroban** RPC (server-side keys only) |
| Consumers | [`frontend`](../frontend/README.md), partner systems, cron workers |

---

## 📁 Package layout

```
backend/
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts              # Fastify bootstrap, CORS, route registration
    ├── config/env.ts         # Typed environment
    └── routes/
        ├── health.ts         # GET /health
        └── v1/index.ts       # Versioned API surface (expand here)
```

---

## 🚀 Quick start

### Prerequisites

- **Node.js** 20.x or **22.x** (LTS)
- npm (or pnpm/yarn per org standard)

### Install & run

```bash
cd backend
npm install
cp .env.example .env
# Edit .env — see tables below
npm run dev
```

Default: **http://localhost:8080** · Health: **GET** `/health` · Meta: **GET** `/api/v1/meta`

### Run with the Next.js frontend

```bash
# Terminal A — API
cd backend && npm run dev

# Terminal B — frontend
cd ../frontend && npm install && npm run dev
```

Set `CORS_ORIGIN` in `.env` to match the web origin (e.g. `http://localhost:3000`).

---

## 📜 Scripts

| Command | Purpose |
| ------- | ------- |
| `npm install` | Install dependencies |
| `npm run dev` | `tsx watch` — reload on change |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled server |
| `npm run lint` | `tsc --noEmit` typecheck |

---

## 🔐 Environment variables

### Baseline (implemented)

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `NODE_ENV` | `development` | Environment name |
| `PORT` | `8080` | Listen port |
| `API_PREFIX` | `/api/v1` | Prefix for versioned routes |
| `CORS_ORIGIN` | `http://localhost:3000` | Browser origin allowed by CORS |

### Production / integration (plan — **do not commit secrets**)

| Variable | Example | Purpose |
| -------- | ------- | ------- |
| `UNDERWRITING_WEBHOOK_SECRET` | (secret) | Verify partner callbacks. |
| `SOROBAN_RPC_URL` | `https://…` | Chain ops. |
| `BANK_FILE_BUCKET` | s3://… | Settlement file drop zone. |

---

## 🔌 HTTP surface

### Implemented (scaffold)

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/health` | Liveness for load balancers & CI |
| GET | `/api/v1/meta` | Service name / version |

### Planned themes (domain routes — implement under `src/routes/v1/`)

- `POST /api/v1/invoices/verify` — buyer acknowledgement webhook.
- `POST /api/v1/pools/:id/drawdown` — orchestrated financing request.
- `POST /api/v1/repayments/ingest` — bank file ingestion.

---

## 🧪 Testing & quality

```bash
npm run lint
```

CI should mirror this (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

Add **contract integration tests** in the Rust workspace and **API integration tests** (e.g. `vitest` + `supertest`) as routes grow.

---

## 🚢 Deployment notes

- Run behind TLS termination (load balancer or reverse proxy).
- Store signing keys in **KMS/HSM**, never in repo.
- Restrict Soroban RPC by IP allowlist or private gateway when possible.
- Emit structured logs (JSON) with **request IDs** for regulator audits (especially MediProof / CivicLedger / ReliefFlow).

---

## 🤝 Contributing

See [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md). Contract changes must stay aligned with this API’s eventual routes and [`../../docs/SITE_MAP.md`](../../docs/SITE_MAP.md).

---

## 📄 License

Match the repository license (Apache-2.0 suggested for OSS grants — confirm per org).

---

## 📞 Support & related docs

| Doc | Link |
| --- | ---- |
| Monorepo overview | [`../../README.md`](../../README.md) |
| Frontend | [`../frontend/README.md`](../frontend/README.md) |
| Architecture notes | [`../../docs/layout-plan.md`](../../docs/layout-plan.md) |
| Milestones → issues | [`../../docs/milestones-issues.md`](../../docs/milestones-issues.md) |

---

**Package:** `invoicelift-api` · **Slug:** `invoicelift`

<!-- Contribution check by sambuilder at 2024-11-04T19:26:53 -->

<!-- Contribution check by robert-j at 2025-02-09T00:57:55 -->

<!-- Contribution check by james-t at 2025-05-16T06:28:57 -->

<!-- Contribution check by sambuilder at 2025-08-20T11:59:59 -->

<!-- Contribution check by robert-j at 2025-11-24T17:31:02 -->

<!-- Contribution check by james-t at 2026-02-28T23:02:04 -->

<!-- Contribution check by sambuilder at 2026-06-05T04:33:06 -->

<!-- Williams-1604 — 2024-12-17 -->

<!-- codemagician1949 — 2025-02-09 -->
