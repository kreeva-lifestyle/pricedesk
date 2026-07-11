# PriceDesk — Myntra live-price fetcher (runs on your laptop)

This little tool fills the **Myntra ₹** column in PriceDesk for free, without any
paid scraping service. Myntra blocks requests from cloud servers, but it trusts
normal home/office internet — so this runs on **your laptop**, fetches the live
selling prices, and sends them to PriceDesk. Every open app and phone then
updates automatically.

You can install it on several laptops. Whichever one is on does the job — they
all write to the same place, so it's completely safe if more than one runs.

---

## One-time setup (about 5 minutes, per laptop)

1. **Install Node.js** (this is what runs the tool). Download the "LTS" version
   from https://nodejs.org and install it (just click Next through the installer).

2. **Get this folder onto the laptop.** Copy the whole `tools/myntra-fetch`
   folder somewhere easy, e.g. `Documents\myntra-fetch`.

3. **Make your config file.** In the folder, copy `config.example.json` and
   rename the copy to `config.json`. It already has the right values filled in —
   you don't need to change anything.

4. **Open a terminal in the folder and install once:**
   - **Windows:** open the folder in File Explorer, click the address bar, type
     `cmd`, press Enter. Then run:
     ```
     npm install
     ```
   - **Mac:** right-click the folder → "New Terminal at Folder", then run
     `npm install`.

That's it — setup is done.

---

## Running it

In that same terminal, in the folder, run:

```
npm start
```

You'll see it count through your products (e.g. `240/1021  (238 ok, 2 failed)`).
When it finishes, open PriceDesk — the **Myntra ₹** column is now filled in, with
the same green/red drift indicators. It takes roughly 20–25 minutes for ~1,000
products (it goes deliberately slowly so Myntra stays happy).

Want to test quickly first? Set `"LIMIT": 20` in `config.json` to fetch just 20
products, confirm the column fills, then set it back to `0` for all.

---

## Trigger it from the app (watch mode)

Instead of running `npm start` by hand, you can leave a small "watcher" running
and press **Update Myntra ₹** in PriceDesk (works from your phone too). Whichever
laptop is on and watching picks up the request and runs the fetch.

Start the watcher:
```
npm run watch
```
It stays running and checks for requests every 20 seconds. Press **Update
Myntra ₹** in the app → within a minute the watcher runs and the app's banner
shows the live progress.

**Make it start automatically when the laptop boots** (so it's always ready):
- **Windows (Task Scheduler):** Create Task → Trigger: **At log on** → Action:
  Start a program → Program: `npm`, Arguments: `run watch`, "Start in": this
  folder. Tick "Run whether user is logged on or not". (Or put a shortcut to
  `npm run watch` in the Startup folder.)
- **Mac/Linux:** add `npm run watch` to a login item / `@reboot` cron entry in
  this folder.

Run it on several laptops if you like — whichever is on responds; they avoid
double-running, and any overlap is harmless. The laptop still has to be powered
on and awake for a request to be picked up; the app warns "no laptop online" if
a request goes unanswered for ~2 minutes.

## Run from your iPhone (no laptop needed)

When no laptop is available, your iPhone can do the whole fetch itself — its
mobile/Wi-Fi connection is exactly the kind Myntra trusts.

**One-time setup (~2 minutes):**
1. Install **Scriptable** from the App Store (free).
2. Open `scriptable-myntra-fetch.js` (this folder) on your phone — easiest is
   opening the file on GitHub in Safari — then Select All → Copy.
3. In Scriptable: tap **+** (new script) → paste → rename it **Myntra Fetch**.

**To run:** open Scriptable → tap **Myntra Fetch** → ▶. Keep Scriptable open
with the screen on until it says **Done** (a few minutes for ~1,000 styles — it
fetches several pages in parallel; plug the phone in, and consider Settings →
Display & Brightness → Auto-Lock → Never while it runs). Progress also shows
live in PriceDesk's banner, with your iPhone's name as the source.

Tips:
- For a quick first test, edit the `LIMIT = 0` line near the top to
  `LIMIT = 20`, run once, then set it back to `0`.
- Speed knobs near the top: `CONCURRENCY` (pages fetched at once, default 8)
  and `PACING_MS`. If you ever see lots of "blocked" results, lower
  `CONCURRENCY` (e.g. 3) or raise `PACING_MS` — Myntra may be rate-limiting.
- If the phone locks or you leave the app, iOS stops the run — just run it
  again; everything fetched so far is already saved (it checkpoints every 100
  styles), and the app will show the "didn't finish" notice until you do.
- The iPhone runs one product at a time (a bit slower than the laptop) and
  cannot "watch" for the app button — it's a run-it-when-you-need-it backup.

## Keeping prices fresh automatically (optional)

Run it on a schedule so prices refresh without you thinking about it:

- **Windows (Task Scheduler):** Create Task → Trigger: Daily (e.g. 2:00 AM) →
  Action: Start a program → Program: `npm`, Arguments: `start`, "Start in": the
  folder path. Tick "Run whether user is logged on or not" and "Wake the
  computer to run this task" if you want it overnight.
- **Mac/Linux (cron):** `crontab -e` then add:
  ```
  0 2 * * *  cd /path/to/myntra-fetch && /usr/local/bin/npm start >> fetch.log 2>&1
  ```

Install the same schedule on each laptop. If two happen to run at once, no
problem — they just write the latest prices (last one wins).

---

## Settings (`config.json`)

| Setting | What it does | Default |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON` | Where to send the prices (pre-filled — leave as is). | — |
| `PACING_MS` | Milliseconds between requests. Higher = gentler on Myntra. | `1500` |
| `MAX_CONCURRENCY` | How many products fetched at once. Keep low (1–3). | `2` |
| `LIMIT` | Fetch only the first N products (`0` = all). Handy for testing. | `0` |

If you ever see lots of "blocked / Site Maintenance" errors, Myntra is
rate-limiting that connection — raise `PACING_MS` (e.g. `3000`) or run from a
different internet connection.

## Troubleshooting

- **"Missing SUPABASE_URL / SUPABASE_ANON"** — you haven't created `config.json`
  yet (only `config.example.json` exists). Copy it: `copy config.example.json config.json`
  (Windows) / `cp config.example.json config.json` (Mac/Linux).
- **"Your SUPABASE_ANON key contains an invalid character…"** — the key got a
  stray character (often a `•` bullet) when it was copied from a hidden/masked
  field. Open `config.json` and re-paste the key as plain text — it should be one
  long line of letters, numbers and dots only, starting with `eyJ`.

---

## How it works (for the curious)

It reads your active Myntra SKUs from Supabase, opens each product page
`https://www.myntra.com/<StyleID>` from your laptop's connection, reads the
price out of the page (the same parser the app uses), and saves the results into
the shared `pd_live_prices` store — the exact place the app's Myntra ₹ column
reads from, so the app updates live. It never changes your SKUs, costs, or any
other data; it only writes live prices.

The price-reading logic lives in `parse.mjs` and is unit-tested in the main
project (`tests/edge-functions/myntra-fetch-parse.test.js`).
