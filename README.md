# InstaSource MVP

InstaSource is a runnable proof-of-concept for an autonomous manufacturing and sourcing agent.

It supports:

- Blueprint/image upload as base64 JSON.
- Vision-to-spec extraction with SenseNova or Kimi when keys are present.
- Mock supplier discovery by default, with a Bright Data adapter boundary for live public web collection.
- Supplier ranking and feasibility report generation.
- Local landed-cost estimate with a Daytona sandbox boundary for production calculation.
- PII masking with a Terminal 3 boundary for private references.

## Run

```bash
cd instasource-mvp
cp .env.example .env
npm start
```

Open `http://localhost:4123`.

No dependencies are required. The app uses Node's built-in `http` server and `fetch`.

## API Keys

Add keys to `.env` when you have them:

- `SENSENOVA_API_KEY`, `SENSENOVA_API_URL`, `SENSENOVA_MODEL`
- `KIMI_API_KEY`, `KIMI_BASE_URL`, `KIMI_MODEL`
- `BRIGHT_DATA_API_KEY`, `BRIGHT_DATA_ZONE`
- `DAYTONA_API_KEY`, `DAYTONA_API_URL`
- `TERMINAL3_API_KEY`, `TERMINAL3_ACTION_URL`

Without keys, the app runs in mock mode so you can demo the workflow immediately.

## Main Endpoint

`POST /api/source`

Request shape:

```json
{
  "partName": "Aluminum keyboard case",
  "quantity": 250,
  "materialHint": "Aluminum 6061",
  "processHint": "CNC machining",
  "finishHint": "black anodized",
  "destinationCountry": "US",
  "destinationPostal": "94107",
  "companyName": "Acme Hardware",
  "shippingAddress": "private address",
  "fileName": "case.png",
  "mimeType": "image/png",
  "fileBase64": "..."
}
```

Response includes the extracted spec, ranked suppliers, logistics estimate, privacy reference, and a sourcing report.

## Production Notes

The MVP deliberately keeps purchase automation out of scope. Add supplier outreach and PO generation only after supplier terms, scraping permissions, and internal approval rules are finalized.
