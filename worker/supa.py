"""
supa.py

Supabase client for the sync worker. Uses the SERVICE ROLE key so the worker
can update guest and event rows regardless of RLS. This key must NEVER be
shipped to the frontend; keep it as a Railway service variable.
"""

import logging
import os
from typing import Optional

from supabase import create_client, Client

_client: Optional[Client] = None


def get_supabase() -> Client:
    global _client
    if _client is not None:
        return _client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "The service_role key bypasses RLS and must stay server-side."
        )
    _client = create_client(url, key)
    logging.info("[supa] connected to %s", url)
    return _client
