#!/usr/bin/env python3
"""
NobelCart Pi scale streamer (HX711 → Supabase → kiosk).

The website already listens on public.carts.weight_kg for the cart in ?cart=.
This process owns ONE physical cart: set cart_id to match that URL param.

Idle until the kiosk sets public.carts.scale_wanted for this cart_id, then:
  wake GPIO → tare (empty pan) → stream weight_kg → sleep when UI says done.

While streaming:
  HX711 sample → outlier reject → median window → EMA → kg
    → publish only when the weight moves enough (or on a slow keepalive)

Tunables live in config.json (see config.example.json). Env overrides:
  CART_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY),
  SCALE_CONFIG=/path/to/config.json

Examples:
  export SUPABASE_SERVICE_ROLE_KEY='...'
  cp config.example.json config.json   # edit cart_id + pins
  python3 scale_stream.py
  python3 scale_stream.py --dry-run
  python3 scale_stream.py --calibrate 1.0   # known weight in kg on the pan
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from collections import deque
from pathlib import Path
from typing import Deque, Optional

try:
    import gpiod
except ImportError:
    print("ERROR: gpiod not installed. On Pi OS: sudo apt install python3-libgpiod", file=sys.stderr)
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. pip3 install requests", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# HX711 — prefer lgpio (short SCK pulses). gpiod is too slow and power-downs
# the chip (clock high must stay under ~50µs).
# ---------------------------------------------------------------------------
def resolve_chip_path(chip_name: str) -> str:
    """gpiod v2 wants /dev/gpiochipN; accept bare 'gpiochip0' too."""
    name = (chip_name or "gpiochip0").strip()
    if name.startswith("/dev/"):
        return name
    return f"/dev/{name}"


def chip_number(chip_name: str) -> int:
    path = resolve_chip_path(chip_name)
    digits = "".join(ch for ch in path.rsplit("gpiochip", 1)[-1] if ch.isdigit())
    return int(digits or "0")


try:
    import lgpio as _lgpio
except ImportError:
    _lgpio = None


class HX711:
    def __init__(self, chip_name: str, dat_pin: int, clk_pin: int):
        self.dat_pin = int(dat_pin)
        self.clk_pin = int(clk_pin)
        self._path = resolve_chip_path(chip_name)
        self._lg = None
        self.chip = None
        self.dat = None
        self.clk = None
        self._req = None

        if _lgpio is not None:
            self._lg = _lgpio.gpiochip_open(chip_number(chip_name))
            _lgpio.gpio_claim_input(self._lg, self.dat_pin)
            _lgpio.gpio_claim_output(self._lg, self.clk_pin, 0)
            return

        v2 = hasattr(gpiod, "request_lines") and hasattr(gpiod, "LineSettings")
        if v2:
            self._req = gpiod.request_lines(
                self._path,
                consumer="HX711",
                config={
                    self.dat_pin: gpiod.LineSettings(direction=gpiod.line.Direction.INPUT),
                    self.clk_pin: gpiod.LineSettings(
                        direction=gpiod.line.Direction.OUTPUT,
                        output_value=gpiod.line.Value.INACTIVE,
                    ),
                },
            )
        else:
            self.chip = gpiod.Chip(chip_name if not chip_name.startswith("/dev/") else chip_name.replace("/dev/", ""))
            self.dat = self.chip.get_line(self.dat_pin)
            self.clk = self.chip.get_line(self.clk_pin)
            self.dat.request(consumer="HX711", type=gpiod.LINE_REQ_DIR_IN)
            self.clk.request(consumer="HX711", type=gpiod.LINE_REQ_DIR_OUT)
            self.clk.set_value(0)

    def power_down(self) -> None:
        """Hold PD_SCK high so the chip sleeps (~µA) until power_up()."""
        try:
            self._set_clk(True)
            time.sleep(0.00012)
        except Exception:
            pass

    def power_up(self) -> None:
        try:
            self._set_clk(False)
            time.sleep(0.08)
        except Exception:
            pass

    def close(self) -> None:
        self.power_down()
        if self._lg is not None and _lgpio is not None:
            try:
                _lgpio.gpiochip_close(self._lg)
            except Exception:
                pass
            self._lg = None
        if self._req is not None:
            try:
                self._req.release()
            except Exception:
                pass
            self._req = None
        try:
            if self.dat is not None:
                self.dat.release()
        except Exception:
            pass
        try:
            if self.clk is not None:
                self.clk.release()
        except Exception:
            pass
        try:
            if self.chip is not None:
                self.chip.close()
        except Exception:
            pass
        time.sleep(0.15)

    def _get_dat(self) -> int:
        if self._lg is not None and _lgpio is not None:
            return 1 if _lgpio.gpio_read(self._lg, self.dat_pin) else 0
        if self._req is not None:
            return 1 if self._req.get_value(self.dat_pin) == gpiod.line.Value.ACTIVE else 0
        return int(self.dat.get_value())

    def _set_clk(self, high: bool) -> None:
        if self._lg is not None and _lgpio is not None:
            _lgpio.gpio_write(self._lg, self.clk_pin, 1 if high else 0)
            return
        if self._req is not None:
            self._req.set_value(
                self.clk_pin,
                gpiod.line.Value.ACTIVE if high else gpiod.line.Value.INACTIVE,
            )
        else:
            self.clk.set_value(1 if high else 0)

    def read_raw(self, ready_timeout_s: float = 0.5) -> Optional[int]:
        deadline = time.monotonic() + ready_timeout_s
        while self._get_dat() == 1:
            if time.monotonic() > deadline:
                return None

        value = 0
        for _ in range(24):
            self._set_clk(True)
            self._set_clk(False)
            value = (value << 1) | (1 if self._get_dat() else 0)

        # 25th pulse → channel A, gain 128
        self._set_clk(True)
        self._set_clk(False)

        if value & 0x800000:
            value -= 0x1000000
        return value

    def average(self, samples: int = 10, gap_s: float = 0.02) -> Optional[float]:
        vals = []
        for _ in range(samples):
            v = self.read_raw()
            if v is not None:
                vals.append(v)
            time.sleep(gap_s)
        if not vals:
            return None
        return statistics.median(vals) if len(vals) >= 3 else (sum(vals) / len(vals))


def open_hx711_with_retry(chip_name: str, dat_pin: int, clk_pin: int, retry_s: float = 30.0) -> HX711:
    """Keep the systemd unit alive until the HX711 is wired / chip appears."""
    path = resolve_chip_path(chip_name)
    while True:
        try:
            return HX711(chip_name=path, dat_pin=dat_pin, clk_pin=clk_pin)
        except Exception as e:
            wait = 2.0 if "busy" in str(e).lower() or getattr(e, "errno", None) == 16 else retry_s
            print(
                f"GPIO/HX711 not ready ({path} DT={dat_pin} SCK={clk_pin}): {e}. "
                f"Waiting {wait:.0f}s — connect wiring then it will start.",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(wait)


# ---------------------------------------------------------------------------
# On-device cleaning (do the cheap work here; web stays simple)
# ---------------------------------------------------------------------------
class WeightFilter:
    """
    Outlier reject → sliding median → EMA.

    All knobs are optional so you can harden later without rewriting I/O.
    """

    def __init__(
        self,
        median_window: int = 5,
        ema_alpha: float = 0.4,
        outlier_ratio: float = 0.35,
    ):
        w = max(1, int(median_window))
        if w % 2 == 0:
            w += 1
        self.window: Deque[float] = deque(maxlen=w)
        self.ema_alpha = max(0.01, min(1.0, float(ema_alpha)))
        self.outlier_ratio = max(0.0, float(outlier_ratio))
        self.ema: Optional[float] = None
        self.last_accepted: Optional[float] = None

    def reset(self) -> None:
        self.window.clear()
        self.ema = None
        self.last_accepted = None

    def push(self, sample_kg: float) -> Optional[float]:
        # Spike reject vs last accepted (ratio of absolute change vs |last| + floor)
        if self.last_accepted is not None and self.outlier_ratio > 0:
            floor = 0.05  # kg — ignore tiny denominators
            jump = abs(sample_kg - self.last_accepted)
            limit = self.outlier_ratio * max(abs(self.last_accepted), floor) + 0.15
            # Allow large jumps when the pan really changes; only kill one-sample spikes
            # that bounce back — handled by requiring median agreement below.
            if jump > max(limit, 0.5) and len(self.window) >= 2:
                # Keep the sample in the window so a real step still wins after a few hits
                pass

        self.window.append(sample_kg)
        if len(self.window) < max(1, self.window.maxlen // 2):
            return None

        med = statistics.median(self.window)
        self.last_accepted = med

        if self.ema is None:
            self.ema = med
        else:
            a = self.ema_alpha
            self.ema = a * med + (1.0 - a) * self.ema
        return self.ema


# ---------------------------------------------------------------------------
# Supabase REST (PATCH only this cart_id — never other carts)
# ---------------------------------------------------------------------------
class CartWeightPublisher:
    def __init__(
        self,
        url: str,
        key: str,
        cart_id: str,
        table: str = "carts",
        cart_id_column: str = "cart_id",
        weight_column: str = "weight_kg",
        dry_run: bool = False,
    ):
        self.base = url.rstrip("/")
        self.cart_id = cart_id
        self.table = table
        self.cart_col = cart_id_column
        self.weight_col = weight_column
        self.dry_run = dry_run
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal,resolution=merge-duplicates",
            }
        )
        self.last_sent: Optional[float] = None
        self.last_sent_at = 0.0
        self._ensure_row()

    def _endpoint(self) -> str:
        return f"{self.base}/rest/v1/{self.table}"

    def _ensure_row(self) -> None:
        """Make sure this cart_id exists so PATCH always hits a row."""
        if self.dry_run:
            print(f"[dry-run] would ensure row cart_id={self.cart_id!r}")
            return
        # Upsert: insert if missing, ignore conflict on cart_id when unique.
        params = {self.cart_col: f"eq.{self.cart_id}", "select": self.cart_col}
        r = self.session.get(self._endpoint(), params=params, timeout=8)
        if r.ok and r.json():
            return
        payload = {self.cart_col: self.cart_id, self.weight_col: 0}
        headers = {"Prefer": "resolution=merge-duplicates,return=minimal"}
        r = self.session.post(
            self._endpoint(),
            params={"on_conflict": self.cart_col},
            json=payload,
            headers=headers,
            timeout=8,
        )
        if not r.ok:
            r2 = self.session.post(self._endpoint(), json=payload, timeout=8)
            if not r2.ok:
                print(f"WARN: could not ensure carts row: {r.status_code} {r.text[:200]}", file=sys.stderr)

    def publish(self, weight_kg: float, *, force: bool = False) -> bool:
        now = time.monotonic()
        if (
            not force
            and self.last_sent is not None
            and abs(weight_kg - self.last_sent) < 1e-9
        ):
            return False

        if self.dry_run:
            print(f"[dry-run] {self.cart_id} → {weight_kg:.3f} kg")
            self.last_sent = weight_kg
            self.last_sent_at = now
            return True

        payload = {self.cart_col: self.cart_id, self.weight_col: weight_kg}
        r = self.session.post(
            self._endpoint(),
            params={"on_conflict": self.cart_col},
            json=payload,
            timeout=5,
        )
        if not r.ok:
            r = self.session.patch(
                self._endpoint(),
                params={self.cart_col: f"eq.{self.cart_id}"},
                json={self.weight_col: weight_kg},
                timeout=5,
            )
        if not r.ok:
            print(f"WARN: upsert failed {r.status_code}: {r.text[:200]}", file=sys.stderr)
            return False
        self.last_sent = weight_kg
        self.last_sent_at = now
        return True

    def poll_wanted(self) -> str:
        """'yes' | 'no' | 'missing' | 'error' — kiosk weight-modal handshake."""
        if self.dry_run:
            return "yes"
        try:
            r = self.session.get(
                self._endpoint(),
                params={self.cart_col: f"eq.{self.cart_id}", "select": "scale_wanted"},
                timeout=5,
            )
        except Exception as exc:
            print(f"WARN: scale_wanted poll failed: {exc}", file=sys.stderr)
            return "error"
        if not r.ok:
            text = (r.text or "")[:200]
            lowered = text.lower()
            if r.status_code in (400, 404) or "scale_wanted" in lowered or "pgrst204" in lowered:
                return "missing"
            print(f"WARN: scale_wanted poll {r.status_code}: {text}", file=sys.stderr)
            return "error"
        rows = r.json()
        if not rows:
            return "no"
        if "scale_wanted" not in rows[0]:
            return "missing"
        return "yes" if rows[0]["scale_wanted"] else "no"

    def set_wanted(self, wanted: bool) -> None:
        if self.dry_run:
            return
        try:
            self.session.patch(
                self._endpoint(),
                params={self.cart_col: f"eq.{self.cart_id}"},
                json={"scale_wanted": wanted},
                timeout=5,
            )
        except Exception as exc:
            print(f"WARN: could not set scale_wanted={wanted}: {exc}", file=sys.stderr)

    def reset_publish_cache(self) -> None:
        self.last_sent = None
        self.last_sent_at = 0.0


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def load_config(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


def resolve_config(args: argparse.Namespace) -> dict:
    cfg_path = Path(args.config or os.environ.get("SCALE_CONFIG") or "config.json")
    if not cfg_path.is_file():
        example = Path(__file__).with_name("config.example.json")
        if example.is_file() and not cfg_path.exists():
            print(f"No {cfg_path}; copy config.example.json → config.json and edit cart_id.")
        raise SystemExit(f"Config not found: {cfg_path}")

    cfg = load_config(cfg_path)
    if args.cart:
        cfg["cart_id"] = args.cart
    if os.environ.get("CART_ID"):
        cfg["cart_id"] = os.environ["CART_ID"]
    if args.dry_run:
        cfg["dry_run"] = True

    sb = cfg.setdefault("supabase", {})
    if os.environ.get("SUPABASE_URL"):
        sb["url"] = os.environ["SUPABASE_URL"]
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_KEY")
        or os.environ.get(sb.get("key_env") or "", "")
    )
    sb["_resolved_key"] = key
    return cfg


def raw_to_kg(raw: float, tare: float, counts_per_kg: Optional[float]) -> float:
    tared = raw - tare
    if counts_per_kg and counts_per_kg != 0:
        return tared / counts_per_kg
    # Uncalibrated: expose tared counts / 1e5 as a rough stand-in so the UI moves.
    return tared / 100000.0


def gpio_kwargs(gpio: dict) -> dict:
    return {
        "chip_name": str(gpio.get("chip") or "/dev/gpiochip0"),
        "dat_pin": int(gpio.get("dat_pin", 17)),
        "clk_pin": int(gpio.get("clk_pin", 27)),
    }


def tare_hx(hx: HX711, samples: int) -> Optional[float]:
    print("Taring — keep the pan empty…", flush=True)
    time.sleep(0.25)
    tare = hx.average(samples=max(4, int(samples)))
    if tare is not None:
        print(f"Tare offset: {tare:.0f}", flush=True)
    return tare


def make_filter(filt: dict) -> WeightFilter:
    return WeightFilter(
        median_window=int(filt.get("median_window") or 5),
        ema_alpha=float(filt.get("ema_alpha") or 0.4),
        outlier_ratio=float(filt.get("outlier_ratio") or 0.35),
    )


def stream_ticks(
    hx: HX711,
    tare: float,
    counts_per_kg: Optional[float],
    wf: WeightFilter,
    publisher: CartWeightPublisher,
    filt: dict,
    should_stop,
    timeout_s: float,
) -> str:
    """
    Read/publish until should_stop() or timeout.
    Returns 'done' | 'timeout' | 'no-signal'.
    """
    min_delta = float(filt.get("min_delta_kg") or 0.005)
    force_ms = float(filt.get("force_send_ms") or 1500)
    digits = int(filt.get("round_digits") or 3)
    sleep_s = float(filt.get("loop_sleep_s") or 0.02)
    started = time.monotonic()
    last_poll = 0.0
    last_ok_read = time.monotonic()

    while True:
        now = time.monotonic()
        if timeout_s > 0 and (now - started) >= timeout_s:
            return "timeout"
        if now - last_poll >= 1.0:
            last_poll = now
            if should_stop():
                return "done"

        raw = hx.read_raw()
        if raw is None:
            if now - last_ok_read > 8.0:
                return "no-signal"
            time.sleep(0.05)
            continue
        last_ok_read = now

        kg = raw_to_kg(raw, tare, counts_per_kg)
        smoothed = wf.push(kg)
        if smoothed is None:
            time.sleep(sleep_s)
            continue

        rounded = round(smoothed, digits)
        moved = publisher.last_sent is None or abs(rounded - publisher.last_sent) >= min_delta
        stale = (now - publisher.last_sent_at) * 1000.0 >= force_ms

        if moved or stale:
            ok = publisher.publish(rounded, force=stale and not moved)
            if ok:
                tag = "Δ" if moved else "keep"
                print(f"{tag}  {rounded:.{digits}f} kg   (raw={raw})")

        time.sleep(sleep_s)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="NobelCart HX711 → Supabase cart weight streamer")
    ap.add_argument("--config", default=None, help="Path to config.json")
    ap.add_argument("--cart", default=None, help="Override cart_id (must match ?cart= on the kiosk)")
    ap.add_argument("--dry-run", action="store_true", help="Print weights; do not call Supabase")
    ap.add_argument(
        "--calibrate",
        type=float,
        metavar="KG",
        help="Known mass on the pan in kilograms; print counts_per_kg and exit",
    )
    ap.add_argument(
        "--calibrate-lb",
        type=float,
        metavar="LB",
        help="Known mass on the pan in pounds (e.g. 1.1). Converted to kg automatically.",
    )
    ap.add_argument(
        "--write-config",
        action="store_true",
        help="After --calibrate / --calibrate-lb, save counts_per_kg into config.json",
    )
    ap.add_argument("--no-tare", action="store_true", help="Skip tare_on_start")
    args = ap.parse_args()

    cfg = resolve_config(args)
    cart_id = str(cfg.get("cart_id") or "").strip()
    if not cart_id:
        raise SystemExit("cart_id is required (config or --cart / CART_ID)")

    gpio = cfg.get("gpio") or {}
    cal = cfg.get("calibration") or {}
    filt = cfg.get("filter") or {}
    sb = cfg.get("supabase") or {}
    dry = bool(cfg.get("dry_run"))

    key = sb.get("_resolved_key") or ""
    calibrating = args.calibrate is not None or args.calibrate_lb is not None
    if not dry and not calibrating and not key:
        raise SystemExit(
            "Set SUPABASE_SERVICE_ROLE_KEY (preferred on the Pi) or SUPABASE_KEY in the environment."
        )

    gkw = gpio_kwargs(gpio)
    tare_samples = int(cal.get("tare_samples") or 20)
    session_cfg = cfg.get("session") or {}
    idle_poll_s = float(session_cfg.get("idle_poll_s") or 1.0)
    timeout_s = float(session_cfg.get("timeout_s") or 90)
    tare_on_session = bool(session_cfg.get("tare_on_session", True)) and not args.no_tare
    configured_tare = cal.get("tare_offset")

    counts_per_kg = cal.get("counts_per_kg")
    if counts_per_kg is not None:
        counts_per_kg = float(counts_per_kg)

    def acquire_tare(hx: HX711, *, force_tare: bool, retry: bool = True):
        """Return (hx, tare_counts). tare_counts is None if the chip stayed silent."""
        if configured_tare is not None and not force_tare:
            print(f"Using configured tare_offset: {float(configured_tare):.0f}")
            return hx, float(configured_tare)
        samples = min(12, tare_samples) if force_tare else tare_samples
        while True:
            tare = tare_hx(hx, samples)
            if tare is not None:
                return hx, float(tare)
            if not retry:
                return hx, None
            print(
                "No HX711 signal yet (wiring not connected?). Waiting 30s…",
                file=sys.stderr,
                flush=True,
            )
            hx.close()
            time.sleep(30)
            hx = open_hx711_with_retry(**gkw)
            time.sleep(0.2)

    if calibrating:
        hx = open_hx711_with_retry(**gkw)
        try:
            hx, tare = acquire_tare(hx, force_tare=not args.no_tare or configured_tare is None)
            if args.calibrate_lb is not None:
                known = float(args.calibrate_lb) * 0.45359237
                print(f"Known mass: {args.calibrate_lb} lb = {known:.4f} kg")
            else:
                known = float(args.calibrate)
            if known <= 0:
                raise SystemExit("calibrate mass must be > 0")
            print("Put the known weight on the pan, wait for it to settle, then wait…", flush=True)
            time.sleep(1.5)
            raw = hx.average(samples=25)
            if raw is None:
                print("ERROR: no reading during calibrate", file=sys.stderr)
                return 1
            tared = raw - tare
            if tared <= 0:
                print(
                    f"ERROR: reading did not increase (raw={raw:.0f} tare={tare:.0f}). "
                    "Is the bottle on the pan? Empty tare first.",
                    file=sys.stderr,
                )
                return 1
            cpk = tared / known
            print(f"counts_per_kg = {cpk:.4f}")
            if args.write_config:
                cfg_path = Path(args.config or os.environ.get("SCALE_CONFIG") or "config.json")
                if not cfg_path.is_file():
                    cfg_path = Path(__file__).with_name("config.json")
                on_disk = json.loads(cfg_path.read_text()) if cfg_path.is_file() else {}
                on_disk.setdefault("calibration", {})["counts_per_kg"] = round(cpk, 4)
                on_disk["calibration"]["tare_offset"] = None
                cfg_path.write_text(json.dumps(on_disk, indent=2) + "\n")
                print(f"Wrote counts_per_kg to {cfg_path}")
            else:
                print("Paste that into config.json → calibration.counts_per_kg")
            print("Restart the scale service when done: sudo systemctl start nobelcart-scale")
            return 0
        except KeyboardInterrupt:
            print("\nStopped.")
            return 0
        finally:
            hx.close()

    if not counts_per_kg:
        print("WARN: counts_per_kg unset — streaming approximate units. Run --calibrate when ready.")

    publisher = CartWeightPublisher(
        url=str(sb.get("url") or ""),
        key=key or "dry-run",
        cart_id=cart_id,
        table=str(sb.get("table") or "carts"),
        cart_id_column=str(sb.get("cart_id_column") or "cart_id"),
        weight_column=str(sb.get("weight_column") or "weight_kg"),
        dry_run=dry,
    )

    hx = None
    try:
        print(
            f"Idle (HX711 powered down) until kiosk weigh for cart_id={cart_id!r}  dry_run={dry}",
            flush=True,
        )
        print("Ctrl+C to stop.")

        hx = open_hx711_with_retry(**gkw)
        hx.power_down()
        missing_warned = False

        while True:
            mode = publisher.poll_wanted()
            if mode == "missing" and not missing_warned:
                print(
                    "WARN: carts.scale_wanted missing — apply supabase/migrations/0018_scale_wanted.sql. "
                    "Streaming until that column exists, then idle between weighs.",
                    flush=True,
                )
                missing_warned = True

            if mode not in ("yes", "missing"):
                wait = idle_poll_s if mode != "error" else max(idle_poll_s, 3.0)
                time.sleep(wait)
                continue

            print("Kiosk requested weight — waking HX711", flush=True)
            hx.power_up()
            hx, tare = acquire_tare(
                hx,
                force_tare=tare_on_session or configured_tare is None,
                retry=False,
            )
            if tare is None:
                print("No HX711 signal; sleeping chip, will retry", file=sys.stderr, flush=True)
                hx.power_down()
                time.sleep(2)
                continue
            publisher.reset_publish_cache()
            publisher.publish(0.0, force=True)
            wf = make_filter(filt)

            reason = stream_ticks(
                hx,
                tare,
                counts_per_kg,
                wf,
                publisher,
                filt,
                should_stop=lambda: publisher.poll_wanted() == "no",
                timeout_s=0 if mode == "missing" else timeout_s,
            )
            print(f"Weigh session ended ({reason}) — HX711 powered down", flush=True)
            if reason == "timeout":
                publisher.set_wanted(False)
            hx.power_down()
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0
    finally:
        if hx is not None:
            hx.close()


if __name__ == "__main__":
    sys.exit(main())
