# Backend Issues Backlog

## Issue: Implement fraud flagging and state freeze support
**Labels:** `security`, `core`
**Description:** Build the backend heuristics to detect potentially fraudulent invoices (e.g., duplicate uploads) and interact with the contract to freeze states.
**Acceptance Criteria:**
- Automated checks against previously financed invoices.
- Admin endpoints to manually trigger a state freeze.
