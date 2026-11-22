# Project Proposal & Technical Spec: PulseBroker (Web-to-Event Broker)

## 1. Executive Summary

**PulseBroker** is a Kafka-style **Web-to-Event Broker and Control Dashboard** built to run smoothly on a local machine. It turns noisy, unverified internet data into clean, fact-checked, real-time event streams that any external app or separate machine can consume via a generated **Base URL + API Key** or **Webhooks**.

Instead of stitching together scrapers, cron jobs, LLM fact-checkers, and message queues, developers create a single Topic and receive trustworthy live events.

---

## 2. The Problem

Modern apps and AI agents are event-driven (push-based), while the web is pull-based and noisy. Developers face four major gaps today:

* **Noise and High Costs:** Basic scrapers and workflow tools repeatedly pull the same unchanged data, wasting API credits and flooding downstream apps.
* **Unverified Data:** Blindly pushing raw scraped news, prices, or alerts into production apps is risky because of fake news and stale info.
* **No Human Safety Gate:** High-impact alerts need quick team verification before broadcasting to third-party consumers.
* **Fragile Delivery:** If a third-party app or webhook endpoint goes down, critical events are lost with no easy way to inspect or replay them.

---

## 3. Who Does What (Sponsor Tech & Role Breakdown)

Each sponsor technology handles a dedicated, core layer of the broker pipeline.

| Component / Tool | Role in the System | Exact Responsibility |
| :--- | :--- | :--- |
| **SerpApi** (Track 1) | **Data Producer (Ingest)** | Fetches live web data (Google News, Shopping, Search, Maps) and extracts clean page content using the Extract API. |
| **You.com** (Track 2) | **Verification & Enrichment** | Cross-checks new web signals against live sources, assigns a truth verdict, and attaches verified citations. |
| **Nexconn Web SDK** (Track 3) | **Real-Time Triage & Event Bus** | Runs lightweight in the browser. Streams live events into a dedicated team triage room where reviewers inspect, discuss, and approve or reject high-risk events in real time. |
| **PulseBroker Engine** (Core) | **Smart Diff, Schema & Delivery** | Compares new data against previous state, drops duplicates, normalizes output into one clean schema, manages API keys, delivers webhooks, and stores history for 1-click replay. |
| **Control Dashboard** (UI) | **Kafka-Style Control Panel** | Lets developers create topics, copy Base URLs & API Keys, inspect live JSON streams, monitor delivery health, and replay failed events. |

---

## 4. Local-First Tech Stack (Low-Spec Machine Friendly)

Designed to run with **zero Docker overhead**, **no Android Studio/emulators**, and minimal RAM usage on a standard local laptop.

| Layer | Technology | Why This Choice |
| :--- | :--- | :--- |
| **Frontend (Dashboard)** | **React (Vite) + Tailwind CSS** | Fast hot-reload, low memory footprint, clean Kafka-style UI. |
| **Real-Time Triage** | **Nexconn Web SDK (JS/npm)** | Runs directly inside the browser. Heavy lifting (WebSockets, storage, routing) happens on Nexconn's cloud servers. |
| **Backend (Broker Engine)** | **Node.js + Express** | Lightweight, non-blocking I/O for handling polling, webhooks, and Server-Sent Events (SSE) simultaneously. |
| **Database** | **SQLite** (via `better-sqlite3` or Drizzle) | Single local file database. Zero background server RAM usage, instant setup, persistent event history. |
| **Networking / Exposure** | **Cloudflare Tunnel (`cloudflared`)** | Free, zero-login CLI tool that exposes `localhost` to a live public HTTPS URL so external machines can connect. |

---

## 5. Networking: Tunneling, Base URL & API Key Mechanics

Since the broker runs on `localhost` without cloud deployment, external machines connect to it using a **Public Tunnel + Dynamic Routing + API Key Auth**.

### A. How the Public Base URL is Generated
1. Start the local backend server on `http://localhost:8000`.
2. Run Cloudflare Tunnel in a separate terminal:
   `cloudflared tunnel --url http://localhost:8000`
3. Cloudflare instantly generates a live public HTTPS URL (e.g., `https://pulse-demo-xyz.trycloudflare.com`).
4. Save this URL in the backend `.env` file as `PUBLIC_BASE_URL`.

### B. How Each Topic Gets Its Own Endpoint & Key
* The backend does **not** spin up new servers per user. It uses a single dynamic route:
  * **REST Read:** `GET /v1/topics/:topic_id/events`
  * **Live Stream (SSE):** `GET /v1/topics/:topic_id/stream`
* When a user creates a topic, the backend:
  1. Generates a unique `topic_id` (e.g., `top_8821`).
  2. Generates a random secret API key (e.g., `sk_live_9a8f7c6d5e4b3a21`) and maps it to `top_8821` in SQLite.
  3. Combines `PUBLIC_BASE_URL` + the dynamic route to give the user their ready-to-use endpoint:
     `https://pulse-demo-xyz.trycloudflare.com/v1/topics/top_8821/stream`

### C. How an External Machine Connects
* **Method 1: Pull / Live Stream (External Machine -> Local Broker)**
  * The external machine/app sends a request to the generated **Base URL** with the header `Authorization: Bearer sk_live_...`.
  * The local broker validates the key against `topic_id` and streams only **verified & approved** JSON events in real time.
* **Method 2: Webhooks (Local Broker -> External App)**
  * Outgoing traffic from `localhost` to the internet needs **no tunnel**.
  * Once approved, the broker sends an HTTP `POST` request directly to Discord, Telegram, or any public webhook URL.

---

## 6. End-to-End Data Flow

### Visual Flow Diagram

```
[1. Developer creates Topic on Local Dashboard]
      -> Generates topic_id + API Key + Tunneled Base URL
                  |
                  v
[2. SerpApi fetches live web data & extracts content]
                  |
                  v
[3. Smart Diff Gate compares with last saved state in SQLite]
        |                          |
   (No Change)               (New Change)
        |                          |
        v                          v
  [Event Dropped]       [4. You.com verifies facts & adds citations]
                                   |
                                   v
                        [5. Normalizer builds Unified Clean Event]
                                   |
                 +-----------------+-----------------+
                 |                                   |
      (Approval Required: ON)             (Approval Required: OFF)
                 |                                   |
                 v                                   |
  [6. Nexconn Web SDK Triage Room]                   |
    (Team clicks Approve/Reject)                     |
                 |                                   |
            (Approved)                               |
                 |                                   |
                 +-----------------+-----------------+
                                   |
                                   v
            [7. Broker saves Event in SQLite & Delivers]
               /                                     \
    (Outbound Webhook)                    (Inbound via Cloudflare Tunnel)
    Discord / Telegram                    External Machine / Client App
    (No tunnel needed)                    (Uses Base URL + API Key)
                                   |
                           (If Delivery Fails)
                                   |
                                   v
                 [8. Dashboard 1-Click Replay Queue]
```

---

## 7. Core Data Schemas

### A. Topic Configuration Schema (SQLite Table: `topics`)

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `topic_id` | String (PK) | Unique topic identifier | `top_8821` |
| `api_key` | String | Secret key for external auth | `sk_live_9a8f7c6d5e4b3a21` |
| `name` | String | Human-readable topic name | `rbi-policy-alerts` |
| `source_engine` | Enum | SerpApi engine to run | `google_news`, `shopping`, `extract` |
| `target_query` | String | Search query or target webpage URL | `"RBI repo rate latest update"` |
| `diff_mode` | Enum | Rule for triggering a new event | `new_item_only`, `price_drop`, `content_change` |
| `verify_truth` | Boolean | Enable You.com citation check | `true` |
| `human_approval` | Boolean | Require Nexconn room approval before push | `true` |
| `webhooks` | JSON Array | List of third-party consumer URLs | `["https://discord.com/api/webhooks/..."]` |
| `status` | Enum | Current topic state | `active`, `paused` |

### B. Unified Event Schema (SQLite Table: `events` & External Output)

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `event_id` | String (PK) | Unique event identifier | `evt_90412` |
| `topic_id` | String (FK) | Parent topic ID | `top_8821` |
| `timestamp` | ISO String | Time when event was detected | `2026-11-22T11:30:00Z` |
| `change_type` | String | What triggered the Smart Diff Gate | `new_update` |
| `title` | String | Clean headline or item name | `"RBI keeps repo rate unchanged"` |
| `summary` | String | Normalized, clean summary text | `"The central bank maintained..."` |
| `verified` | Boolean | Result from You.com fact-check | `true` |
| `citations` | JSON Array | List of verified source URLs | `["https://rbi.org.in/...", "..."]` |
| `approval_status` | Enum | Nexconn triage status | `pending`, `approved`, `rejected`, `auto_approved` |
| `delivery_status` | Enum | Webhook delivery outcome | `delivered`, `failed`, `replayed` |

---

## 8. Market Differentiation (Why This Wins)

| Existing Category | What They Do Well | The Gap PulseBroker Solves |
| :--- | :--- | :--- |
| **n8n / Zapier** | Connecting basic SaaS triggers | No built-in Smart Diffing, no live citation verification, and no Kafka-style event replay dashboard. |
| **Kafka / Upstash** | High-speed internal event streaming | Cannot fetch, diff, or fact-check live public internet data. |
| **Apify / Firecrawl** | Raw web scraping and crawling | Stops at raw extraction. Does not provide team triage, approval gates, or reliable multi-consumer webhook delivery. |

---

## 9. Local Execution & Live Demo Plan (For Judges)

### Startup Sequence (3 Terminals, Low RAM)
1. **Terminal 1 (Backend):** `npm run dev` -> Starts Node/Express Broker + SQLite on `localhost:8000`.
2. **Terminal 2 (Tunnel):** `cloudflared tunnel --url http://localhost:8000` -> Exposes local broker to the internet.
3. **Terminal 3 (Frontend):** `npm run dev` -> Starts React Dashboard + Nexconn Web SDK on `localhost:5173`.

### Live Demo Steps
1. **Create a Topic Live:** Set up a topic with Verification ON, Nexconn Approval ON, and a live Discord/Telegram webhook. Show the auto-generated **Tunneled Base URL + API Key**.
2. **Trigger & Show Smart Diff:** Run the poll twice. Show how the first run detects a new event, and the second run drops the duplicate to save credits.
3. **Show Citation Verification:** Inspect the event in the dashboard to display the You.com `verified` badge and live citations.
4. **Live Triage in Nexconn:** Open the in-browser Nexconn room, review the pending event, and click **Approve**.
5. **Cross-Machine Delivery & Replay:** Show the clean JSON arriving both in Discord/Telegram (Webhook) and on a **second machine/device** connected via the Tunneled Base URL + API Key. Simulate a failed endpoint and demonstrate **1-Click Replay**.