"""Conservative account-wide D1 Free budgeting; analytics is not a global lock."""
import datetime as dt
import json
import math
import urllib.error
import urllib.request

FREE_WRITES = 100_000
ACCOUNT_WRITE_CEILING = FREE_WRITES
ACCOUNT_READ_CEILING = 5_000_000


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def day_key(now=None):
    return (now or utc_now()).date().isoformat()


def next_window(now=None):
    now = now or utc_now()
    tomorrow = now.date() + dt.timedelta(days=1)
    return dt.datetime.combine(tomorrow, dt.time(0, 5), dt.timezone.utc).isoformat()


def analytics(account, token, now=None, opener=None):
    now = now or utc_now()
    day = day_key(now)
    query = """query MigrationAccountUsage($account: string!, $from: Date!, $to: Date!) {
      viewer { accounts(filter: {accountTag: $account}) {
        d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $from, date_leq: $to}) {
          sum { rowsWritten rowsRead }
        }
      }}
    }"""
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/graphql",
        data=json.dumps({"query": query, "variables": {"account": account, "from": day, "to": day}}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST",
    )
    try:
        with (opener or urllib.request.urlopen)(request, timeout=45) as response:
            payload = json.load(response)
        if payload.get("errors"):
            raise ValueError("analytics permission or query rejected")
        accounts = payload["data"]["viewer"]["accounts"]
        if len(accounts) != 1:
            raise ValueError("account analytics identity is ambiguous")
        groups = accounts[0]["d1AnalyticsAdaptiveGroups"]
        if len(groups) >= 10_000:
            raise ValueError("account analytics result may be truncated")
        written, read = 0, 0
        for group in groups:
            values = group["sum"]
            for key in ("rowsWritten", "rowsRead"):
                value = values[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                    raise ValueError("invalid account analytics counter")
            written += math.ceil(values["rowsWritten"])
            read += math.ceil(values["rowsRead"])
        return {"day": day, "observed_at": now.isoformat(), "rows_written": written, "rows_read": read}
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as error:
        raise RuntimeError("account usage could not be verified; no new database writes authorized") from error


def charge_for(batch, history=None):
    estimate = batch.get("estimated_rows_written")
    if isinstance(estimate, bool) or not isinstance(estimate, int) or estimate < 0:
        raise ValueError("batch has no valid write-cost estimate")
    sample = (history or {}).get(batch.get("phase"))
    if batch.get("phase") == "search" and sample:
        numerator, denominator = sample.get("max_writes"), sample.get("max_estimate")
        if numerator is not None or denominator is not None:
            if (isinstance(numerator, bool) or not isinstance(numerator, int) or numerator < 0
                    or isinstance(denominator, bool) or not isinstance(denominator, int) or denominator <= 0):
                raise ValueError("invalid search write-cost history")
            # Search costs vary with indexed content; retain the largest observed
            # ratio to the sealed estimate proxy rather than averaging rows.
            measured = (numerator * estimate * 5 + denominator * 4 - 1) // (denominator * 4)
            return max(128, measured)
        return max(128, estimate * 2)
    rows = batch.get("data_rows", 0)
    if sample and rows:
        if (isinstance(rows, bool) or not isinstance(rows, int) or rows < 0
                or any(isinstance(sample.get(key), bool) or not isinstance(sample.get(key), int)
                       or sample[key] < 0 for key in ("rows", "writes", "samples"))):
            raise ValueError("invalid phase write-cost history")
        if sample["rows"] and sample["samples"]:
            realistic = batch.get("realistic_rows_written", 0)
            if isinstance(realistic, bool) or not isinstance(realistic, int) or realistic < 0:
                raise ValueError("invalid realistic write-cost estimate")
            # Integer arithmetic keeps the 25% margin exact even for large counts.
            measured = (sample["writes"] * rows * 5 + sample["rows"] * 4 - 1) // (sample["rows"] * 4)
            return max(128, realistic, measured)
    # Old immutable plans have only the original conservative estimate.
    return max(128, estimate * 2)


def observe(ledger, usage):
    entry = ledger.setdefault(usage["day"], {"charged": 0})
    # For a legacy ledger, the first stored observation is the only available
    # baseline; it may already contain local writes, so it can overcount them.
    entry.setdefault("baseline_written", entry.get("observed_written", usage["rows_written"]))
    entry["observed_written"] = max(entry.get("observed_written", 0), usage["rows_written"])
    entry["observed_read"] = max(entry.get("observed_read", 0), usage["rows_read"])


def decide(usage, ledger, reserved, now=None):
    """Estimate shared use without double-counting local receipts.

    Analytics can lag, and other clients can write after observation: this is
    neither a global lock nor a guarantee that a reservation fits the quota.
    """
    now = now or utc_now()
    day = day_key(now)
    if usage.get("day") != day:
        raise ValueError("account usage is from a different UTC day")
    if isinstance(reserved, bool) or not isinstance(reserved, int) or reserved < 0:
        raise ValueError("invalid reservation")
    if reserved > ACCOUNT_WRITE_CEILING:
        raise ValueError("one indivisible batch exceeds the account daily ceiling")
    entry = ledger.get(day, {})
    charged = entry.get("charged", 0)
    written = max(usage["rows_written"], entry.get("observed_written", 0))
    baseline = entry.get("baseline_written", entry.get("observed_written", usage["rows_written"]))
    accounted = baseline + max(written - baseline, charged)
    read = max(usage["rows_read"], entry.get("observed_read", 0))
    seconds_left = 86_400 - (now.hour * 3_600 + now.minute * 60 + now.second)
    reason = None
    if seconds_left <= 300:
        reason = "utc_reset_window"
    elif read >= ACCOUNT_READ_CEILING:
        reason = "account_read_reserve"
    elif accounted + reserved > ACCOUNT_WRITE_CEILING:
        reason = "account_write_reserve"
    return {"allowed": reason is None, "reason": reason, "reserved": reserved,
            "observed_rows_written": written, "locally_charged": charged,
            "baseline_rows_written": baseline, "accounted_rows_written": accounted,
            "account_write_ceiling": ACCOUNT_WRITE_CEILING,
            "next_attempt_at": None if reason is None else next_window(now),
            "analytics_is_delayed": True}


def reserve(ledger, amount, now=None):
    if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0:
        raise ValueError("invalid reservation")
    day = day_key(now)
    entry = ledger.setdefault(day, {"charged": 0})
    entry["charged"] += amount
    return day


def settle(ledger, reservation_day, reserved, actual, now=None):
    if isinstance(actual, bool) or not isinstance(actual, int) or actual < 0:
        raise ValueError("invalid observed write count")
    current_day = day_key(now)
    if current_day == reservation_day:
        ledger[reservation_day]["charged"] += actual - reserved
    else:
        # Execution spanning midnight cannot be apportioned reliably.
        ledger[reservation_day]["charged"] += max(0, actual - reserved)
        reserve(ledger, actual, now)
