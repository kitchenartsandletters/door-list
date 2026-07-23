"""
sync_guests.py — daily cron

Reconciles Supabase `guests` rows (source='order') against current Shopify
orders for every active, Shopify-linked event.

Strategy: Shopify's order search doesn't reliably filter by
`line_items.product_id`, so we:
  1. Load active events with shopify_product_id set.
  2. Pull orders updated in the last SYNC_LOOKBACK_DAYS (default 90).
  3. For each order line item matching a tracked product, count toward
     that event's aggregation using `currentQuantity` (post-refund).
  4. Aggregate by (event_id, normalized_buyer_name) → {name, qty}.
  5. Reconcile against Supabase order-sourced rows:
       - Canonical buyer + matching active row  → update qty (clamp
         checked_in if lowering below it).
       - Canonical buyer + matching soft-deleted row → skip (respect
         manual removal).
       - Canonical buyer + no row → insert.
       - Active row + buyer no longer canonical → soft-delete with
         reason "Shopify: refunded/cancelled".
  6. Manually-added rows (source='manual' or 'door') never touched.
"""

import logging
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Tuple

from shopify_client import ShopifyClient
from supa import get_supabase

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sync_guests")

SYNC_LOOKBACK_DAYS = int(os.getenv("SYNC_LOOKBACK_DAYS", "90"))

ORDERS_QUERY = """
query RecentOrders($cursor: String, $q: String!) {
  orders(first: 100, after: $cursor, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name cancelledAt
      billingAddress { firstName lastName name }
      customer { firstName lastName displayName }
      lineItems(first: 100) {
        nodes { id quantity currentQuantity product { id } title }
      }
    }
  }
}
"""


def normalize_name(name: str) -> str:
    return " ".join(name.strip().split()).lower()


def buyer_name(order: dict) -> str:
    ba = order.get("billingAddress") or {}
    candidate = (ba.get("name") or "").strip()
    if not candidate:
        first = (ba.get("firstName") or "").strip()
        last = (ba.get("lastName") or "").strip()
        candidate = (first + " " + last).strip()
    if not candidate:
        c = order.get("customer") or {}
        candidate = (c.get("displayName") or "").strip()
        if not candidate:
            candidate = ((c.get("firstName") or "") + " " + (c.get("lastName") or "")).strip()
    return candidate or "Unknown buyer"


def fetch_recent_orders(shop: ShopifyClient, since: date) -> Iterable[dict]:
    q = f"updated_at:>={since.isoformat()}"
    cursor = None
    total = 0
    while True:
        result = shop.graphql(ORDERS_QUERY, {"cursor": cursor, "q": q})
        page = result["orders"]
        for order in page["nodes"]:
            yield order
        total += len(page["nodes"])
        log.debug("Fetched %d orders so far", total)
        if not page["pageInfo"]["hasNextPage"]:
            break
        cursor = page["pageInfo"]["endCursor"]
    log.info("Fetched %d total orders (since %s)", total, since.isoformat())


def load_shopify_events(supa) -> List[dict]:
    result = (supa.table("events")
              .select("id, name, is_bundle, shopify_product_id")
              .eq("status", "active")
              .not_.is_("shopify_product_id", "null")
              .execute())
    return result.data or []


def aggregate(orders: Iterable[dict], product_to_event: Dict[str, dict]) -> Dict[Tuple[str, str], dict]:
    agg: Dict[Tuple[str, str], dict] = {}
    for order in orders:
        if order.get("cancelledAt"):
            continue
        name = buyer_name(order)
        norm = normalize_name(name)
        if not norm:
            continue
        for li in order["lineItems"]["nodes"]:
            product = li.get("product") or {}
            product_gid = product.get("id")
            if not product_gid:
                continue
            event = product_to_event.get(product_gid)
            if not event:
                continue
            qty = li.get("currentQuantity")
            if qty is None:
                qty = li.get("quantity") or 0
            if qty <= 0:
                continue
            key = (event["id"], norm)
            cur = agg.get(key)
            if cur is None:
                agg[key] = {"name": name, "qty": qty, "includes_book": bool(event["is_bundle"])}
            else:
                cur["qty"] += qty
                if len(name) > len(cur["name"]):
                    cur["name"] = name
    return agg


def reconcile_event(supa, event: dict, canonical_for_event: Dict[str, dict]) -> Dict[str, int]:
    stats = defaultdict(int)
    event_id = event["id"]
    existing_rows = (supa.table("guests")
                     .select("id, name, qty, checked_in, deleted_at, deleted_reason")
                     .eq("event_id", event_id)
                     .eq("source", "order")
                     .execute()).data or []
    by_norm = {normalize_name(r["name"]): r for r in existing_rows}
    for norm, cur in canonical_for_event.items():
        row = by_norm.get(norm)
        if row is None:
            supa.table("guests").insert({
                "event_id": event_id, "name": cur["name"], "qty": cur["qty"],
                "checked_in": 0, "source": "order", "includes_book": cur["includes_book"],
            }).execute()
            stats["inserted"] += 1
            continue
        if row["deleted_at"]:
            stats["skipped_deleted"] += 1
            continue
        patch = {}
        if row["qty"] != cur["qty"]:
            patch["qty"] = cur["qty"]
            if cur["qty"] < row["checked_in"]:
                patch["checked_in"] = cur["qty"]
                log.warning("Event %s: %r qty %d -> %d (clamped checked_in %d -> %d)",
                            event["name"], row["name"], row["qty"], cur["qty"],
                            row["checked_in"], cur["qty"])
        if row["name"] != cur["name"]:
            patch["name"] = cur["name"]
        if bool(row.get("includes_book")) != cur["includes_book"]:
            patch["includes_book"] = cur["includes_book"]
        if patch:
            supa.table("guests").update(patch).eq("id", row["id"]).execute()
            stats["updated"] += 1
        else:
            stats["unchanged"] += 1
    for norm, row in by_norm.items():
        if norm in canonical_for_event or row["deleted_at"]:
            continue
        supa.table("guests").update({
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "deleted_reason": "Shopify: refunded or cancelled",
        }).eq("id", row["id"]).execute()
        stats["soft_deleted"] += 1
        log.info("Event %s: %r no longer in Shopify — soft-deleted", event["name"], row["name"])
    return dict(stats)


def main() -> int:
    log.info("=== sync_guests starting (lookback=%d days) ===", SYNC_LOOKBACK_DAYS)
    shop = ShopifyClient()
    shop.validate_connection()
    supa = get_supabase()
    events = load_shopify_events(supa)
    if not events:
        log.info("No active Shopify-linked events. Nothing to sync.")
        return 0
    log.info("Reconciling %d active Shopify-linked events", len(events))
    product_to_event = {e["shopify_product_id"]: e for e in events}
    since = date.today() - timedelta(days=SYNC_LOOKBACK_DAYS)
    orders = fetch_recent_orders(shop, since)
    canonical = aggregate(orders, product_to_event)
    log.info("Aggregated %d unique (event, buyer) pairs from Shopify", len(canonical))
    per_event: Dict[str, Dict[str, dict]] = defaultdict(dict)
    for (event_id, norm), val in canonical.items():
        per_event[event_id][norm] = val
    totals: Dict[str, int] = defaultdict(int)
    for ev in events:
        stats = reconcile_event(supa, ev, per_event.get(ev["id"], {}))
        for k, v in stats.items():
            totals[k] += v
        log.info("Event %r: %s", ev["name"], dict(stats))
    log.info("=== sync_guests done: %s ===", dict(totals))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.exception("sync_guests failed: %s", e)
        sys.exit(1)
