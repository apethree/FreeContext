---
title: "Security Launch Readiness: Controls Enabled for v1"
description: "A summary of the concrete security controls, policies, and operational checks now active ahead of the OneShot public launch."
date: 2026-03-03
author: CapZero Team
tags: [security, announcement]
---

As we approach public launch, we want users and teams evaluating OneShot to know exactly what is already in place.

This update outlines the controls currently active for v1 and how we are operating launch-day monitoring.

## Controls active now

- TLS is enforced for all production endpoints.
- Session and provider-token handling is isolated per tenant boundary.
- Production access is role-scoped and logged.
- Security/legal pages are live and versioned on the website.

## Launch-day operating model

For launch week, we are running a tighter incident loop:

1. Real-time uptime checks on the homepage, news, docs, and legal paths.
2. Faster rollback path for website deploys via Cloudflare Pages.
3. Daily verification pass for redirects, headers, and broken-link regressions.

## User-facing promise

OneShot is designed so users keep control of their provider connections and operational context. We will keep publishing implementation updates as controls evolve post-launch.
