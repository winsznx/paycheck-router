#!/usr/bin/env python3
"""Keeps the hosted fork's clock on wall time.

Surfpool 1.5.0 produces an extra slot every time a blockhash expires (every 75 slots), so a
long-running fork's Clock gains about 0.6 s a minute. After an hour every real Pyth price looks
older than the program's 30 s limit and nothing can buy. A clock can only be paused, never moved
back, and the drift only runs ahead, so whenever the fork is a second or more ahead of wall time
this pauses it for that long.
"""

import base64
import json
import struct
import time
import urllib.request

RPC = "http://127.0.0.1:18899"
CLOCK = "SysvarC1ock11111111111111111111111111111111"
CHECK_EVERY_SECS = 20
MAX_AHEAD_SECS = 1


def rpc(method, params=None):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []})
    request = urllib.request.Request(RPC, body.encode(), {"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        reply = json.load(response)
    if "error" in reply:
        raise RuntimeError(f"{method}: {reply['error']}")
    return reply["result"]


def seconds_ahead():
    data = rpc("getAccountInfo", [CLOCK, {"encoding": "base64"}])["value"]["data"][0]
    unix_timestamp = struct.unpack("<q", base64.b64decode(data)[32:40])[0]
    return unix_timestamp - time.time()


def main():
    while True:
        try:
            ahead = seconds_ahead()
            if ahead >= MAX_AHEAD_SECS:
                rpc("surfnet_pauseClock")
                try:
                    time.sleep(ahead)
                finally:
                    rpc("surfnet_resumeClock")
                print(f"fork clock was {ahead:.1f}s ahead; paused it for that long", flush=True)
        except Exception as error:
            print(f"clock check failed: {error}", flush=True)
        time.sleep(CHECK_EVERY_SECS)


if __name__ == "__main__":
    main()
