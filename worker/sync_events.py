"""
sync_events.py — weekly cron

Pulls every Shopify product with product_type == "Event", parses an MM-DD-YYYY
tag as the event date, and upserts a matching row in the Supabase `events`
table. Past-dated active events are auto-archived. Manually-created events
(no shopify_product_id) are never touched.
"""

import logging
import os
import re
import sys
from datetime import date
from typing import List, Optional

from shopify_client import ShopifyClient
from supa import get_supabase

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sync_events")

DATE_TAG_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{4})$")
BOOK_BUNDLE_TAG = "book-bundle"

EVENT_PRODUCTS_QUERY = """
query EventProducts($cursor: String) {
  products(first: 100, after: $cursor, query: "product_type:Event") {
    pageInfo { hasNextPage endCursor }
    nodes { id title productType tags status }
  }
}
"""


def parse_date_tag(tags: List[str]) -> Optional[date]:
    for t in tags:
        m = DATE_TAG_RE.match(t.strip())
        if not m:
            continue
        mm, dd, yyyy = m.groups()
        try:
            return date(int(yyyy), int(mm), int(dd))
        except ValueError:
            continue
    return None


def fetch_event_products(shop: ShopifyClient) -> List[dict]:
    products, cursor = [], None
    while True:
        result = shop.graphql(EVENT_PRODUCTS_QUERY, {"cursor": cursor})
        page = result["products"]
        products.extend(page["nodes"])
        if not page["pageInfo"]["hasNextPage"]:
            break
        cursor = page["pageInfo"]["endCursor"]
    return products


def main() -> int:
    log.info("=== sync_events starting ===")
    shop = ShopifyClient()
    shop.validate_connection()
    supa = get_supabase()
    products = fetch_event_products(shop)
    log.info("Fetched %d Event products from Shopify", len(products))
    today = date.today()
    stats = {"inserted": 0, "updated": 0, "auto_archived": 0, "skipped_no_date": 0}
    for p in products:
        product_gid = p["id"]
        title = p["title"]
        tags = p.get("tags", []) or []
        event_date = parse_date_tag(tags)
        is_bundle = BOOK_BUNDLE_TAG in [t.lower().strip() for t in tags]
        if event_date is None:
            log.warning("Skipping %r — no MM-DD-YYYY tag", title)
            stats["skipped_no_date"] += 1
            continue
        existing = supa.table("events").select("*").eq("shopify_product_id", product_gid).execute()
        if existing.data:
            ev = existing.data[0]
            patch = {"name": title, "event_date": event_date.isoformat(), "is_bundle": is_bundle}
            if event_date < today and ev["status"] == "active":
                patch["status"] = "archived"
                stats["auto_archived"] += 1
                log.info("Auto-archiving past event: %r (%s)", title, event_date)
            supa.table("events").update(patch).eq("id", ev["id"]).execute()
            stats["updated"] += 1
        else:
            new_ev = {
                "name": title, "event_date": event_date.isoformat(),
                "shopify_product_id": product_gid, "is_bundle": is_bundle,
                "status": "archived" if event_date < today else "active",
            }
            supa.table("events").insert(new_ev).execute()
            stats["inserted"] += 1
            log.info("Inserted %r (%s)%s", title, event_date, " [bundle]" if is_bundle else "")
    log.info("=== sync_events done: inserted=%d updated=%d auto_archived=%d skipped_no_date=%d ===",
             stats["inserted"], stats["updated"], stats["auto_archived"], stats["skipped_no_date"])
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.exception("sync_events failed: %s", e)
        sys.exit(1)
