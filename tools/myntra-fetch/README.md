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

---

## How it works (for the curious)

It reads your active Myntra SKUs from Supabase, opens each product page
`https://www.myntra.com/<StyleID>` from your laptop's connection, reads the
price out of the page (the same parser the app uses), and saves the results into
the shared `pd_live_prices` store — the exact place the app's Myntra ₹ column
reads from, so the app updates live. It never changes your SKUs, costs, or any
other data; it only writes live prices.

The price-reading logic in `parse.mjs` is a mirror of the app's
`supabase/functions/myntra-price/parse.ts` and is kept in sync by an automated
test in the main project.
