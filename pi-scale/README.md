# NobelCart Pi Scale — Operator Notes

Use this when you need to bring the weight pipeline back up without re-researching the repo.

Last updated: 2026-08-14

---

## What this system does

Each physical cart has:

1. A **Raspberry Pi 5** reading an **HX711** load cell.
2. A **cart id** string (e.g. `cart-1`) that identifies that cart everywhere.
3. A kiosk browser URL that includes the same id: `...?cart=cart-1`.

Flow:

```
HX711 → Pi (filter + calibrate) → Supabase public.carts.weight_kg
                                         ↓ Realtime
                              Kiosk / weight modal (same cart_id)
```

The website does **not** talk to the Pi. It only reads / subscribes to Supabase.

---

## Cart id (critical)

| Place | Role |
|--------|------|
| Kiosk URL `?cart=cart-1` | Identifies which cart UI this tablet/browser is |
| `cart-id.js` / `localStorage` `nc_cart_id` | Persists that id on the device |
| Pi `config.json` → `cart_id` | **Must be the same string** as the kiosk URL |
| Supabase `carts.cart_id` | Row key the Pi PATCHes; web filters on this |

**Rule:** one Pi ↔ one `cart_id` ↔ one kiosk URL. Never point two Pis at the same `cart_id`.

---

## Hardware wiring (Pi 5)

Default in `config.example.json` (BCM numbering):

| HX711 | Pi GPIO (BCM) | Physical pin (40-pin header) |
|--------|----------------|------------------------------|
| DT / DAT | **GPIO 17** | Pin 11 |
| SCK / CLK | **GPIO 27** | Pin 13 |
| VCC | 3.3V or 5V (match module) | — |
| GND | GND | — |

Also connect the load cell to the HX711 (E+/E−/A+/A− per your cell’s datasheet).

GPIO chip name on Pi 5 is usually `gpiochip0`. Confirm with:

```bash
gpiodetect
gpioinfo
```

If pins change, edit `config.json` → `gpio.dat_pin` / `gpio.clk_pin` only. Do **not** use the old `RPi.GPIO` script on Pi 5; use **`gpiod`** (`python3-libgpiod`).

---

## Software on the Pi

Location in this repo: **`pi-scale/`**

| File | Purpose |
|------|---------|
| `scale_stream.py` | Main streamer: read → filter → PATCH Supabase |
| `config.example.json` | Template; copy to `config.json` on the Pi |
| `config.json` | Local secrets/settings (**gitignored**) |
| `requirements.txt` | `requests` (prefer apt for gpiod) |

### Install (once per Pi)

```bash
sudo apt update
sudo apt install -y python3-libgpiod python3-requests
# or: pip3 install -r requirements.txt
cd /path/to/NobelCart-Full/pi-scale
cp config.example.json config.json
# edit cart_id, pins, then set key:
export SUPABASE_SERVICE_ROLE_KEY='…'   # prefer service role on device; keep off git
```

### Run

```bash
# Print only (no network)
python3 scale_stream.py --dry-run

# Live stream for this cart
python3 scale_stream.py

# Override cart without editing file
CART_ID=cart-2 python3 scale_stream.py
# or
python3 scale_stream.py --cart cart-2
```

### Calibrate (accuracy)

1. Empty pan → start once so tare is set (or leave `tare_on_start: true`).
2. Put a **known mass** on the pan (e.g. 1.000 kg).
3. Run:

```bash
python3 scale_stream.py --calibrate 1.0
```

4. Paste the printed `counts_per_kg` into `config.json` → `calibration.counts_per_kg`.
5. Restart the streamer.

Without `counts_per_kg`, the script still streams a rough stand-in (tared counts / 1e5) so you can test plumbing; it is **not** real kg.

---

## Filtering (speed vs noise)

Cleaning runs **on the Pi before upload** so the web stays simple and Realtime traffic stays low.

Pipeline inside `scale_stream.py`:

1. Raw HX711 sample  
2. Sliding **median** window  
3. **EMA** smooth  
4. Publish only if change ≥ `min_delta_kg`, else occasional keepalive (`force_send_ms`)

Knobs in `config.json` → `filter`:

| Key | Effect if you raise it | Effect if you lower it |
|-----|------------------------|-------------------------|
| `median_window` | More stable, slightly slower | Faster, noisier |
| `ema_alpha` | Tracks steps faster (less smooth) | Smoother, laggier |
| `min_delta_kg` | Fewer Supabase writes | More live updates |
| `force_send_ms` | Less keepalive traffic | UI refreshes even when still |
| `loop_sleep_s` | Lower CPU | Higher sample rate |

Start with the example defaults. Tighten noise after the first live cart works.

Further “backend” filtering can still be added later; prefer Pi-side first for latency and cost.

---

## Supabase contract (what the web expects)

Table: **`public.carts`**

| Column | Used for |
|--------|----------|
| `cart_id` (text, unique enough to filter) | Match kiosk / Pi |
| `weight_kg` (numeric / float) | Live weight in kilograms |

Pi does:

- Ensure a row exists for this `cart_id` (insert/upsert if missing).
- `PATCH /rest/v1/carts?cart_id=eq.<id>` with `{ "weight_kg": <number> }`.

Website:

| File | Behavior |
|------|----------|
| `index.html` | Reads `weight_kg` for `?cart=`; Realtime on `carts` filtered by `cart_id` |
| `site.js` → `showWeightModal` | Same: fetch + Realtime `postgres_changes` on `carts` for `CART_ID` |

Realtime: `carts` must be in the `supabase_realtime` publication (if live updates stop, check that first).

Auth on the Pi: use **`SUPABASE_SERVICE_ROLE_KEY`** (or a key that can update `carts`). Do not commit that key. Anon key may fail if RLS blocks unauthenticated updates.

---

## Quick bring-up checklist

1. [ ] HX711 wired (DAT/SCK/GND/VCC); `gpiodetect` OK  
2. [ ] `config.json` `cart_id` == kiosk `?cart=`  
3. [ ] `SUPABASE_SERVICE_ROLE_KEY` set on Pi  
4. [ ] `python3 scale_stream.py --dry-run` shows changing numbers when you press the pan  
5. [ ] `--calibrate` with known weight → set `counts_per_kg`  
6. [ ] Live run; open `index.html?cart=<same-id>` and confirm kg updates  
7. [ ] Open a weighted product → weight modal auto-fills from the same row  

---

## Failure cheat sheet

| Symptom | Likely cause |
|---------|----------------|
| `No HX711 signal` / timeouts | Wrong pins, power, or `gpio.chip` name |
| Dry-run moves, site stuck | Wrong `cart_id`, RLS/key, or Realtime not on `carts` |
| Site shows wrong cart’s weight | Two devices sharing one `cart_id` |
| Stable but wrong kg | Bad / missing `counts_per_kg`; re-tare and recalibrate |
| Jumpy kg | Raise `median_window`, lower `ema_alpha`, raise `min_delta_kg` |
| Laggy kg | Raise `ema_alpha`, lower `median_window` / `min_delta_kg` |

---

## Related code map (repo)

```
pi-scale/scale_stream.py     ← Pi producer
pi-scale/config.example.json ← settings template
cart-id.js                   ← kiosk cart id persistence
index.html                   ← live weight display on home
site.js (showWeightModal)    ← produce scale modal + auto-add
config.js                    ← browser Supabase URL + anon key (read path)
```

There is **no** older Pi script checked into this repo; the working web contract is `carts.weight_kg` + `cart_id`. Rebuild any Pi logic against that contract.

---

## Auto-boot kiosk (scale + website)

Folder: **`pi-scale/kiosk/`**

On boot this starts:

1. `scale_stream.py` (weight → Supabase)
2. Chromium **fullscreen kiosk** for `SITE_URL?cart=CART_ID`

Kiosk lockdown:

- Full screen, no error bubbles / restore crash nag
- Fresh Chrome profile every launch → **no saved passwords / autofill**
- Policies: no password manager, no translate, popups/notifications blocked
- Cursor hidden (`unclutter`)
- Screen blanking disabled when X is available
- Touch enabled

### Simple install (on the Pi)

```bash
cd pi-scale
sudo bash kiosk/install.sh
sudo nano /etc/nobelcart/kiosk.env
```

Set:

- `SITE_URL=https://your-site/index.html`
- `CART_ID=cart-1`  (same as `config.json`)
- `SUPABASE_SERVICE_ROLE_KEY=...`

Then:

```bash
# Desktop auto-login: sudo raspi-config → System Options → Auto Login → Desktop
sudo reboot
```

### Manual test

```bash
sudo systemctl start nobelcart-scale
sudo -u pi /home/pi/pi-scale/kiosk/start-browser.sh
# or both:  ./kiosk/start-all.sh
```

If **two** browsers open after reboot, disable one launcher:

```bash
sudo systemctl disable nobelcart-kiosk
# OR remove ~/.config/autostart/nobelcart-kiosk.desktop
```
