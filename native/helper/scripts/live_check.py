#!/usr/bin/env python3
"""Live checks against a running helper (see live-check.sh, which starts one on a temp socket).

Passive by default: it reads windows and focus but never types, clicks, switches apps or touches
the clipboard. It prints counts, timings and roles only, never screen text or field values.

  live_check.py <socket> [--locked] [--watch SECONDS] [--write-test]

--watch       enable the trigger key and print events for N seconds (press right ⌥, switch apps)
--write-test  MANUAL ONLY: after a 3 s countdown, writes a test line into the focused field of the
              frontmost app (focus a scratch field first)
"""
import json
import select
import socket
import sys
import time

OWN = ("org.stuhi.dumbledore", "com.github.Electron")


class Helper:
    """Line-oriented JSON-RPC over the Unix socket; notifications are collected in `events`."""

    def __init__(self, path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(path)
        self.buf = b""
        self.next_id = 0
        self.events = []

    def _line(self, deadline):
        while b"\n" not in self.buf:
            left = deadline - time.time()
            if left <= 0 or not select.select([self.sock], [], [], left)[0]:
                return None
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("helper closed the connection")
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        return json.loads(line)

    def call(self, method, params=None, timeout=15):
        self.next_id += 1
        rid = self.next_id
        msg = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}}
        started = time.time()
        self.sock.sendall((json.dumps(msg) + "\n").encode())
        deadline = started + timeout
        while True:
            reply = self._line(deadline)
            if reply is None:
                raise RuntimeError(f"{method} timed out after {timeout} s")
            if reply.get("id") == rid:
                return reply, (time.time() - started) * 1000
            if "method" in reply and "id" not in reply:
                self.events.append(reply)

    def listen(self, seconds):
        deadline = time.time() + seconds
        while True:
            msg = self._line(deadline)
            if msg is None:
                return
            if "method" in msg:
                self.events.append(msg)


results = {"PASS": 0, "FAIL": 0, "WARN": 0, "SKIP": 0}


def report(status, name, detail=""):
    results[status] += 1
    print(f"{status:4} {name}" + (f" — {detail}" if detail else ""))


def check(ok, name, detail="", warn=False):
    report("PASS" if ok else ("WARN" if warn else "FAIL"), name, detail)
    return ok


def window_summary(w):
    chars = sum(len(l["text"]) for l in w["lines"])
    return f"{w['bundleId']} src={w['source']} changed={w['changed']} lines={len(w['lines'])} chars={chars}"


def describe_event(e):
    p = e.get("params") or {}
    m = e["method"]
    if m == "focus.changed":
        el = p.get("element")
        app = (p.get("app") or {}).get("bundleId")
        if not el:
            return f"focus.changed app={app} element=null"
        return (f"focus.changed app={app} role={el['role']} editable={el['editable']} secure={el['isSecure']} "
                f"frame={'y' if el['frame'] else 'n'} caret={'y' if el['caret'] else 'n'} ref={'y' if el['ref'] else 'n'}")
    if m == "app.activated":
        return f"app.activated {p.get('bundleId')}"
    if m == "helper.log":
        return f"helper.log {p.get('level')}"
    return f"{m} {json.dumps(p)}"


def main():
    args = sys.argv[1:]
    path = args[0]
    locked = "--locked" in args
    watch = float(args[args.index("--watch") + 1]) if "--watch" in args else 0
    h = Helper(path)

    # Basics
    r, ms = h.call("ping")
    perms = r["result"]["permissions"]
    check(r["result"]["version"] == 1, "ping", f"{ms:.0f} ms, permissions {perms}")
    ax, rec = perms["accessibility"], perms["screenRecording"]
    r, _ = h.call("system.idle")
    check(r["result"]["seconds"] >= 0, "system.idle", f"{r['result']['seconds']:.1f} s")
    r, _ = h.call("system.displays")
    ds = r["result"]["displays"]
    check(len(ds) >= 1 and sum(1 for d in ds if d["isMain"]) == 1, "system.displays",
          f"{len(ds)} display(s), notch={[d['hasNotch'] for d in ds]}")
    r, _ = h.call("no.such.method")
    check(r.get("error", {}).get("code") == -32601, "unknown method → -32601")
    r, _ = h.call("llm.onDevice.status")
    st = r["result"]
    check("available" in st, "llm.onDevice.status", f"available={st['available']} reason={st['reason']}")
    if st["available"]:
        schema = {"type": "object", "properties": {"answer": {"type": "string"}, "confidence": {"type": "number"}},
                  "required": ["answer", "confidence"]}
        r, ms = h.call("llm.onDevice.generate", {"instructions": "Answer briefly.", "prompt": "What is 2 + 2?",
                                                 "schema": schema, "maxTokens": 64, "temperature": 0}, timeout=120)
        res = r.get("result") or {}
        check(isinstance(res.get("json"), dict) and "answer" in res["json"], "llm.onDevice.generate", f"{ms:.0f} ms")
    else:
        report("SKIP", "llm.onDevice.generate", "model unavailable")

    # Refusal paths: never type anything.
    r, _ = h.call("input.write", {"text": "x", "mode": "insert", "target": None, "expectPid": -1})
    if ax:
        check(r.get("result", {}).get("reason") == "frontmostChanged", "input.write aborts on another expectPid")
    else:
        check(r.get("error", {}).get("code") == -32001, "input.write needs Accessibility")
    r, _ = h.call("input.key", {"combo": "cmd+notakey"})
    check(r.get("error", {}).get("code") in (-32602, -32001), "input.key rejects unknown combos")
    for enabled in (True, False):
        r, _ = h.call("shortcut.configure", {"key": "rightOption", "tapMaxMs": 350, "holdMinMs": 500,
                                             "doubleTapMs": 300, "enabled": enabled})
        check(r.get("result", {}).get("ok") is True, f"shortcut.configure enabled={enabled}")

    # Screen-dependent checks
    r, _ = h.call("frontmost")
    front = r["result"]
    if locked:
        r, _ = h.call("perceive", {"scope": "frontmost"})
        check(r["result"]["windows"] == [], "perceive returns [] while locked")
        report("SKIP", "screen checks", "screen is locked")
    elif front is None:
        report("SKIP", "screen checks", "no frontmost app")
    else:
        fid = front["bundleId"]
        own = fid.startswith(OWN)
        check(bool(fid), "frontmost", f"{fid} title={'y' if front['windowTitle'] else 'n'} "
              f"url={'y' if front['url'] else 'n'} fullScreen={front['isFullScreen']}")
        if ax:
            h.listen(0.6)  # focus.changed is re-sent to every new client
            got = [e for e in h.events if e["method"] == "focus.changed"]
            check(bool(got), "focus.changed on connect", describe_event(got[-1]) if got else "no event")
        r, ms = h.call("perceive", {"scope": "frontmost"})
        wins = r["result"]["windows"]
        if own:
            check(wins == [], "perceive never reads Dumbledore's own windows")
        elif check(len(wins) == 1, "perceive frontmost", f"{ms:.0f} ms " + (window_summary(wins[0]) if wins else "")):
            w = wins[0]
            check(w["contentHash"].startswith(w["source"] + ":"), "content hash names its source")
            check(w["source"] != "ax" or ms < 400, "AX perceive latency < 400 ms", f"{ms:.0f} ms", warn=True)
            r, ms = h.call("perceive", {"scope": "frontmost"})
            w2 = r["result"]["windows"]
            check(bool(w2) and not w2[0]["changed"] and w2[0]["lines"] == [], "unchanged window → changed=false",
                  f"{ms:.0f} ms", warn=True)
            r, _ = h.call("perceive", {"scope": "frontmost", "excludeBundleIds": [fid]})
            check(r["result"]["windows"] == [], "excludeBundleIds honoured")
            if rec:
                r, ms = h.call("perceive", {"scope": "frontmost", "forceOcr": True})
                wo = r["result"]["windows"]
                check(bool(wo) and wo[0]["source"] == "ocr", "forced OCR", f"{ms:.0f} ms " + (window_summary(wo[0]) if wo else ""))
                r, ms = h.call("perceive", {"scope": "frontmost", "forceOcr": True})
                wo = r["result"]["windows"]
                check(bool(wo) and not wo[0]["changed"], "dHash skips re-OCR of an unchanged window", f"{ms:.0f} ms", warn=True)
            else:
                report("SKIP", "OCR checks", "no Screen Recording")
        r, ms = h.call("perceive", {"scope": "visible"})
        vis = r["result"]["windows"]
        check(len(vis) <= 6 and not any(w["bundleId"].startswith(OWN) for w in vis), "perceive visible",
              f"{ms:.0f} ms, {len(vis)} window(s): " + ", ".join(w["bundleId"] for w in vis))
        if ax:
            r, ms = h.call("ax.focused")
            el = r["result"]
            if el is None:
                check(True, "ax.focused", "nothing focused")
            else:
                safe = not el["isSecure"] or (el["valueLength"] is None and el["placeholder"] is None)
                check(safe and bool(el["role"]), "ax.focused", f"{ms:.0f} ms role={el['role']} editable={el['editable']} "
                      f"secure={el['isSecure']} caret={'y' if el['caret'] else 'n'}")
            r, ms = h.call("ax.findChatInput", {"pid": None, "placeholders": ["Ask anything", "Message", "Reply"]})
            res = r["result"]
            check("found" in res, "ax.findChatInput", f"{ms:.0f} ms found={res['found']} method={res['method']}")
        else:
            report("SKIP", "AX checks", "no Accessibility")

    if "--write-test" in args:
        for n in (3, 2, 1):
            print(f"writing into the focused field in {n} …", flush=True)
            time.sleep(1)
        r, _ = h.call("frontmost")
        pid = (r["result"] or {}).get("pid")
        r, ms = h.call("input.write", {"text": "Dumbledore write test ✓", "mode": "insert", "target": None,
                                       "method": "auto", "expectPid": pid, "restoreClipboard": True})
        res = r.get("result") or {}
        check(res.get("ok") is True, "input.write (manual)", f"{ms:.0f} ms {json.dumps(r.get('result') or r.get('error'))}")

    if watch:
        h.events.clear()
        h.call("shortcut.configure", {"key": "rightOption", "tapMaxMs": 350, "holdMinMs": 500,
                                      "doubleTapMs": 300, "enabled": True})
        print(f"watching events for {watch:.0f} s: tap / double-tap / hold right ⌥, switch apps, lock the screen …",
              flush=True)
        end = time.time() + watch
        shown = 0
        while time.time() < end:
            h.listen(min(0.5, end - time.time()))
            for e in h.events[shown:]:
                print("  event:", describe_event(e), flush=True)
            shown = len(h.events)

    print(" · ".join(f"{k} {v}" for k, v in results.items()))
    return 1 if results["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
