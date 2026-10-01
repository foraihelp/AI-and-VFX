# AI & VFX Daily Video Digest

Emails you one digest per day listing **new videos** about **Foundry Nuke**, **Boris FX Silhouette**, **Boris FX Mocha / Mocha Pro** and **ComfyUI**. It runs on GitHub Actions, so no server has to stay on.

- Official vendor channels are ranked first, then release walkthroughs, webinars, workflows and tutorials.
- Every item shows title, channel, date, platform, a type label and a direct link. Descriptions are shown only when the creator wrote one - nothing is invented, and **no AI service is used or needed**.
- Already-sent videos are remembered in `state/seen.json`.

Layout: `video_digest/` (code), `config/sources.yaml` (everything you edit), `tests/`, `sample_data/`, and the workflow at `.github/workflows/video-digest.yml`.

## 1. Try it locally (no accounts needed)

```bash
pip install -r requirements-dev.txt
python -m pytest -q                 # unit tests (no network, no email)
python -m video_digest --sample     # dry run on bundled sample data
python -m video_digest              # dry run on real feeds: prints, sends nothing, saves nothing
```

Dry run is the default. Nothing is sent or remembered unless you pass `--send`.

## 2. Get the channel IDs (one time)

`config/sources.yaml` lists the official channels by `@handle`, but the RSS fallback needs the `UC...` channel ID, and I could not verify IDs offline, so none are guessed. With a YouTube API key:

```bash
python -m video_digest resolve-channels
```

It prints each channel's ID and the **channel name YouTube reports** - check the name is right (especially `@FoundryTeam`), then paste the IDs into `channel_id:`. With an API key set, the app can also resolve handles itself at run time, but pasting the IDs saves quota and enables the key-less fallback.

## 3. GitHub setup

1. Push this repo to GitHub. In **Settings -> Actions -> General -> Workflow permissions**, allow Actions to run (the workflow itself requests `contents: write` only, to commit the state file).
2. **Settings -> Secrets and variables -> Actions -> Secrets**, add:

   | Secret | Needed for |
   |---|---|
   | `EMAIL_TO` | your address (comma-separate several) |
   | `RESEND_API_KEY` | Resend provider |
   | `SMTP_PASSWORD` | SMTP provider (Gmail: an App Password) |
   | `YOUTUBE_API_KEY` | optional, enables searches and live/Shorts detection |

3. Same page, **Variables** tab (all optional except `EMAIL_FROM`):

   | Variable | Default | Meaning |
   |---|---|---|
   | `EMAIL_PROVIDER` | `resend` | `resend` or `smtp` |
   | `EMAIL_FROM` | - | e.g. `Video Digest <digest@yourdomain.com>` |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_SECURITY` | - / 587 / - / `starttls` | SMTP only |
   | `LOOKBACK_HOURS` | 48 | normal look-back window |
   | `INITIAL_LOOKBACK_HOURS` | 72 | first run only |
   | `SEND_EMPTY` | `true` | `false` = no email on empty days |
   | `DIGEST_TIMEZONE` | `UTC` | timezone used to *display* dates, e.g. `America/New_York` |
   | `SUMMARIES` | `description` | `off` hides descriptions |
   | `MAX_ITEMS_PER_SOFTWARE` | 15 | cap per section |
   | `INCLUDE_SHORTS` | `false` | include YouTube Shorts |

### Email providers
- **Resend** (simplest): create an account and API key at resend.com. Without a verified domain you can only send from `onboarding@resend.dev` to your own account email. Set `EMAIL_FROM=Video Digest <onboarding@resend.dev>`.
- **SMTP / Gmail**: enable 2-step verification, create an App Password, then `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=you@gmail.com`, `EMAIL_FROM=you@gmail.com`, secret `SMTP_PASSWORD`.

### YouTube API key (optional but recommended)
Google Cloud Console -> create a project -> enable **YouTube Data API v3** -> Credentials -> API key (restrict it to that API). Free quota is 10,000 units/day: each search costs 100, the default 10 searches cost ~1,000, plus a few units per channel.
Without a key the app uses channel RSS only: no searches, and it cannot detect live streams or measure duration (Shorts are then caught only by `#shorts` / `/shorts/` URLs).

### Test delivery manually
**Actions -> Daily AI & VFX video digest -> Run workflow**, then pick:
1. `test-email` - sends a one-line message; confirms secrets and provider work.
2. `dry-run` - runs discovery and prints the digest in the log; no email, no state change.
3. `send` - the real thing (sends and commits state).

## 4. Schedule

GitHub cron is **UTC only**. Edit the `cron:` line in the workflow: `"minute hour * * *"`.
Pick the UTC time that equals your preferred local time:

| You want (local) | Cron (UTC) |
|---|---|
| 08:00 London in summer (BST, UTC+1) | `0 7 * * *` |
| 08:00 New York in summer (EDT, UTC-4) | `0 12 * * *` |
| 07:30 India (UTC+5:30) | `0 2 * * *` |

Daylight-saving shifts move local delivery by an hour twice a year; update the line then. `DIGEST_TIMEZONE` only changes how dates are *shown*. GitHub may delay scheduled runs by several minutes. Scheduled runs also stop after 60 days without repository activity - the state commits count as activity, but if the repo goes quiet re-enable the workflow in the Actions tab.

## 5. Managing sources (`config/sources.yaml`)

- **Add a channel**: add a block under `channels:` with `name`, `channel_id`, `software: [nuke]`. Set `official: true` for vendors, `trust_all: true` only for single-product channels (otherwise the title/description must match the software's terms - important for Foundry and Boris FX, who cover many products).
- **Disable**: `enabled: false`. **Remove**: delete the block.
- **Searches**: edit `searches:` (API key required).
- **Other platforms**: add RSS/Atom URLs under `feeds:` (Vimeo, PeerTube, vendor blogs with video feeds).
- **Matching**: each software has `strong` terms (match alone), `weak` terms (match only with a `context` term - this is how "Nuke" or "Mocha" avoid game and coffee videos) and `exclude` terms. Add a noisy word to `exclude` when something irrelevant slips through.
- **Type labels** come from `type_rules` (checked against titles, in order release, webinar, workflow, tutorial).

If a source fails (outage, bad ID), the others still run and the problem is logged and appended to the digest as a warning.

## 6. How it behaves

- **First run**: no state file exists, so only the last `INITIAL_LOOKBACK_HOURS` (72) are considered - no backlog flood.
- **Later runs**: look back `LOOKBACK_HOURS` (48, deliberately overlapping a day); duplicates are removed using the seen list.
- **Dedupe**: by canonical video ID/URL, and by same-title re-uploads on the same channel (the official or earliest copy wins).
- **Excluded**: Shorts (<= 60 s or tagged), live/upcoming streams, global noise words, unrelated uses of the names.
- **Order**: within each software section, official/release items first, then newest first. A video that matches several products appears once under the first (config order) with an "Also covers" line.
- **No new videos**: a short "no new videos" email, or nothing if `SEND_EMPTY=false`.
- Retries with backoff on 429/5xx and network errors (honours `Retry-After`) for both APIs and email.

## 7. State and concurrency tradeoffs

State is a small JSON file committed to the repo by the workflow, which is simple, visible and free.

- **Concurrent runs**: the workflow's `concurrency` group queues runs one at a time, and the commit step does `git pull --rebase` + push with retries.
- **Ordering**: the email is sent first, state saved only afterwards. If the commit/push fails after a successful send you may get duplicates next time (at-least-once) rather than silently missing videos. A failed send leaves state untouched, so nothing is lost.
- **Costs**: one tiny commit per day; the repo history grows slowly. IDs older than 400 days are pruned.
- **Branch protection**: if `master` is protected against direct pushes, the commit step fails; allow the Actions bot or keep state on a dedicated branch.
- A corrupt state file stops the run with a clear error instead of re-sending a backlog; delete it to reset to first-run behaviour.

## 8. Privacy and security

- Secrets live only in GitHub secrets / local `.env` (git-ignored); `.env.example` has placeholders. Keys are redacted from logs and error messages, and config errors name the missing setting, never its value.
- Your recipient address is stored as a secret, not in the repo. Note that **a public repo exposes the state file and workflow logs** (video IDs only; the digest itself is not logged except in `dry-run`) - consider a private repo.
- Data sent to third parties: the YouTube API (queries + your key), and your email provider (digest content). No AI/LLM service is called; none is required.
- Uses only the YouTube Data API and official channel RSS feeds - no page scraping.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing email settings: ...` | add the named secret/variable |
| Resend `403/422` | `EMAIL_FROM` domain unverified - use `onboarding@resend.dev` and your own account email while testing |
| SMTP login failed | Gmail needs an App Password, not your normal password |
| Warning "Channel ... skipped: no channel_id" | run `resolve-channels` and fill `channel_id` |
| No searches happening | `YOUTUBE_API_KEY` missing |
| HTTP 403 quota from YouTube | trim `searches:` or wait for the daily quota reset |
| Digest always empty | try `python -m video_digest -v`; widen `LOOKBACK_HOURS`; check matching terms |
| Push of state rejected | see branch protection above |
| Want a fresh start | delete `state/seen.json` |
