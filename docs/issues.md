# Backend Issues Backlog

## Issue: Implement fraud flagging and state freeze support
**Labels:** `security`, `core`
**Description:** Build the backend heuristics to detect potentially fraudulent invoices (e.g., duplicate uploads) and interact with the contract to freeze states.
**Acceptance Criteria:**
- Automated checks against previously financed invoices.
- Admin endpoints to manually trigger a state freeze.

## Issue: Add automated repayment notification emails
**Labels:** `enhancement`, `notifications`
**Description:** Send email alerts to SMEs X days before an invoice repayment is due to the pool, reducing accidental delinquencies.
**Acceptance Criteria:**
- Cron job for daily checks of upcoming dues.
- Integration with email provider (e.g., SendGrid).
- Customizable email templates.

## Issue: Integrate with accounting software APIs
**Labels:** `feature`, `integrations`
**Description:** Allow SMEs to connect their accounting software (e.g., Xero, QuickBooks) to automatically sync and verify invoices for financing.
**Acceptance Criteria:**
- OAuth2 flow for at least one major accounting platform.
- Webhook endpoints to handle invoice status changes from the accounting software.
