# LeuBai V2 — A Personal Agency Layer

[中文 README](README.md)

[![CI](https://github.com/tim0n1994/leubai-v2/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tim0n1994/leubai-v2/actions/workflows/ci.yml)
[![Preview release](https://img.shields.io/github/v/release/tim0n1994/leubai-v2?include_prereleases&label=preview)](https://github.com/tim0n1994/leubai-v2/releases) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [Security policy](SECURITY.md)

> Keep time human.

LeuBai is a local-first personal agency layer for intent, responsibility, authorization, action, and protected time.

It keeps one request from silently becoming a commitment, one suggestion from silently becoming consent, and one dispatched action from being presented as an externally verified result.

~~~text
intent → request → responsibility → plan → preview → authorization → action → verification
~~~

## What it protects

- **Intent stays distinct from obligation.** A request is not automatically your responsibility.
- **Preview stays distinct from execution.** The proposed change remains visible before it is written.
- **Authorization stays bounded.** Approval is explicit, limited, and revocable.
- **Readback stays distinct from dispatch.** “Sent” is not the same as “received”.
- **Unscheduled time is valid.** Leaving time empty is a protected outcome, not a failure.

The domain model and interface copy are built around those boundaries. The project does not turn an inference into a fact or treat an optimistic UI state as external confirmation.

## Start locally

Requires Node.js 22.22.2 or a compatible version.

~~~sh
npm ci
npm run build
npm start
~~~

Open http://127.0.0.1:5200. The same local entry serves the built page and local API. For development, run npm run server and npm run dev; LEUBAI_PORT and LEUBAI_API_URL control the local endpoints.

## Release boundary

The current reproducible public preview is [v0.0.0-preview.4](https://github.com/tim0n1994/leubai-v2/releases/tag/v0.0.0-preview.4). V2 and V3 in the repository are stage names, not release numbers.

LeuBai is a public preview, not a production product. The design/ assets are static design references, not runtime screenshots; real deployment, visual acceptance, and device acceptance are separate evidence layers. Source code, CI, or design assets do not substitute for those checks.