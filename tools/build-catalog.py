#!/usr/bin/env python3
"""build-catalog.py — Generate versioned DNS service catalog manifest.

Reads services.json + dns-providers.json, resolves each service domain
against each AI/DPI DNS provider, writes service-dns-profiles.json with
verified domain→IP records.

Usage:
    python3 build-catalog.py
    python3 build-catalog.py --resolve  # also do live DNS resolution (needs network)
    python3 build-catalog.py --check    # validate existing manifest

Output: catalog/service-dns-profiles.json (deterministic from input data)
"""

import json
import hashlib
import re
import os
import sys
import time
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
CATALOG_DIR = PROJECT_DIR / "zapret2-manager" / "files" / "usr" / "libexec" / "zapret2-manager" / "catalog"
SERVICES_PATH = CATALOG_DIR / "services.json"
PROVIDERS_PATH = CATALOG_DIR / "dns-providers.json"
OUTPUT_PATH = CATALOG_DIR / "service-dns-profiles.json"

UPSTREAM_COMMIT = "41c7fed7fe06774eff01e75d51bbee065c2de206"
UPSTREAM_REPO = "youtubediscord/zapret"

IPV4_RE = re.compile(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$')
IPV6_RE = re.compile(r'^[0-9a-fA-F:]+$')


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def is_valid_ipv4(val):
    return bool(IPV4_RE.match(val))


def resolve_domain(domain, nameserver, timeout=5):
    """Resolve a domain against a specific nameserver using dig/drill."""
    try:
        cmd = ['dig', f'@{nameserver}', domain, 'A', '+short', f'+time={timeout}']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 2)
        ips = [line.strip() for line in result.stdout.strip().split('\n') if is_valid_ipv4(line.strip())]
        if not ips:
            # Try nslookup as fallback
            try:
                cmd2 = ['nslookup', domain, nameserver]
                result2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=timeout + 2)
                for line in result2.stdout.split('\n'):
                    if 'Address:' in line and not line.strip().startswith('#'):
                        parts = line.strip().split(':')
                        if len(parts) >= 2:
                            ip = parts[-1].strip()
                            if is_valid_ipv4(ip) and ip != nameserver:
                                ips.append(ip)
            except Exception:
                pass
        return ips
    except Exception as e:
        return []


def resolve_aaaa(domain, nameserver, timeout=5):
    """Resolve AAAA records against a specific nameserver."""
    try:
        cmd = ['dig', f'@{nameserver}', domain, 'AAAA', '+short', f'+time={timeout}']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 2)
        return [line.strip() for line in result.stdout.strip().split('\n') if IPV6_RE.match(line.strip())]
    except Exception:
        return []


def build_empty_profile(service, provider, required_domains, optional_domains=None):
    """Build a profile entry with empty records (for lazy DNS resolution)."""
    return {
        "id": f"prof-{service['id']}-{provider['id']}",
        "providerId": provider['id'],
        "serviceId": service['id'],
        "requiredDomains": required_domains,
        "optionalDomains": optional_domains or [],
        "diagnosticTargets": [required_domains[0]] if required_domains else [],
        "records": [],
        "mechanism": "dns-resolve",
        "resolvedAt": None,
        "limitations": service.get('limitations', ''),
        "notes": f"A records resolved from {provider['name']} ({provider['ipv4'][0] if provider['ipv4'] else 'N/A'}) at apply time."
    }


def resolve_records(domain_names, provider, timeout=5):
    """Resolve all domains against a provider and return records list."""
    records = []
    dns_ip = provider['ipv4'][0] if provider['ipv4'] else None
    if not dns_ip:
        return records

    for hostname in domain_names:
        a_records = resolve_domain(hostname, dns_ip, timeout)
        aaaa_records = resolve_aaaa(hostname, dns_ip, timeout)
        if a_records or aaaa_records:
            records.append({
                "hostname": hostname,
                "A": a_records,
                "AAAA": aaaa_records
            })
    return records


def build_manifest(resolve=False):
    """Build the complete manifest."""
    services = load_json(SERVICES_PATH)
    providers = load_json(PROVIDERS_PATH)

    svc_list = services.get('services', [])
    prv_list = providers.get('providers', [])

    # We generate profiles for all providers except the ones that are
    # purely informational (we skip Nothing/null providers).
    # Every real DNS provider can potentially serve any service.
    
    profiles = []
    generated_at = datetime.now(timezone.utc).isoformat()

    for service in svc_list:
        svc_id = service['id']
        svc_domains = service.get('domains', [])
        if not svc_domains:
            print(f"  SKIP {svc_id}: no domains", file=sys.stderr)
            continue

        for provider in prv_list:
            prv_id = provider['id']
            prv_ips = provider.get('ipv4', [])
            if not prv_ips:
                continue

            # Build profile
            profile = build_empty_profile(service, provider, svc_domains)

            if resolve:
                print(f"  Resolving {svc_id} via {prv_id} ({prv_ips[0]})...", file=sys.stderr)
                records = resolve_records(svc_domains, provider)
                if records:
                    profile['records'] = records
                    profile['resolvedAt'] = generated_at
                    # Compute hash of resolved data for integrity
                    rec_str = json.dumps(records, sort_keys=True)
                    profile['contentHash'] = hashlib.sha256(rec_str.encode()).hexdigest()[:16]
                else:
                    print(f"    WARNING: no A records for {svc_id} via {prv_id}", file=sys.stderr)
                    # Keep profile but with empty records — UI will show as incomplete

            profiles.append(profile)

    # Compute manifest digest
    manifest = {
        "schemaVersion": 2,
        "datasetVersion": "2.0.0",
        "upstreamCommit": UPSTREAM_COMMIT,
        "upstreamRepo": UPSTREAM_REPO,
        "upstreamPath": "src/dns/dns_providers.py + src/hosts/proxy_domains.py (QUICK_SERVICES)",
        "generatedAt": generated_at,
        "resolveMode": "live" if resolve else "lazy",
        "providerCount": len(prv_list),
        "serviceCount": len(svc_list),
        "profileCount": len(profiles),
        "providers": [
            {
                "id": p['id'],
                "name": p['name'],
                "upstreamName": p.get('upstreamName', p['name']),
                "category": p.get('category', ''),
                "ipv4": p.get('ipv4', []),
                "ipv6": p.get('ipv6', []),
                "doh": p.get('doh'),
                "sourceUrl": p.get('doh') or (f"udp://{p['ipv4'][0]}" if p.get('ipv4') else None),
                "sourceRevision": UPSTREAM_COMMIT,
                "sourceHash": "",
                "reviewedAt": generated_at[:10],
                "expiresAt": None,
                "trust": "public",
                "notes": p.get('notes', '')
            }
            for p in prv_list
        ],
        "profiles": profiles
    }

    # Compute overall digest
    manifest_str = json.dumps(manifest, sort_keys=True, ensure_ascii=False)
    manifest['contentDigest'] = hashlib.sha256(manifest_str.encode()).hexdigest()

    return manifest


def main():
    import argparse
    ap = argparse.ArgumentParser(description='Build DNS service catalog manifest')
    ap.add_argument('--resolve', action='store_true', help='Do live DNS resolution (needs network)')
    ap.add_argument('--check', action='store_true', help='Validate existing manifest')
    ap.add_argument('-o', '--output', default=str(OUTPUT_PATH), help='Output path')
    args = ap.parse_args()

    if args.check:
        if not OUTPUT_PATH.exists():
            print(f"ERROR: {OUTPUT_PATH} not found", file=sys.stderr)
            sys.exit(1)
        manifest = load_json(OUTPUT_PATH)
        errs = validate_manifest(manifest)
        if errs:
            for e in errs:
                print(f"  FAIL: {e}", file=sys.stderr)
            sys.exit(1)
        print(f"OK: {OUTPUT_PATH} — {manifest.get('profileCount', 0)} profiles, {manifest.get('serviceCount', 0)} services, {manifest.get('providerCount', 0)} providers")
        return

    print(f"Loading {SERVICES_PATH}", file=sys.stderr)
    print(f"Loading {PROVIDERS_PATH}", file=sys.stderr)
    
    if args.resolve:
        print("Live DNS resolution: ON", file=sys.stderr)
    
    manifest = build_manifest(resolve=args.resolve)
    
    os.makedirs(os.path.dirname(args.output) if os.path.dirname(args.output) else '.', exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    
    print(f"\nWrote: {args.output}", file=sys.stderr)
    print(f"  Services: {manifest['serviceCount']}", file=sys.stderr)
    print(f"  Providers: {manifest['providerCount']}", file=sys.stderr)
    print(f"  Profiles: {manifest['profileCount']}", file=sys.stderr)
    print(f"  Digest: {manifest.get('contentDigest', 'N/A')[:16]}", file=sys.stderr)
    print(f"  Resolved: {sum(1 for p in manifest['profiles'] if p.get('records'))}", file=sys.stderr)


def validate_manifest(m):
    errs = []
    if m.get('schemaVersion') != 2:
        errs.append(f"schemaVersion must be 2, got {m.get('schemaVersion')}")
    if not m.get('profiles'):
        errs.append("no profiles")
    svc_ids = set()
    prv_ids = set(p['id'] for p in m.get('providers', []))
    for p in m.get('profiles', []):
        svc_ids.add(p.get('serviceId'))
        if not p.get('providerId'):
            errs.append(f"profile {p.get('id')}: missing providerId")
        elif p['providerId'] not in prv_ids:
            errs.append(f"profile {p.get('id')}: unknown providerId {p['providerId']}")
        if not p.get('requiredDomains'):
            errs.append(f"profile {p.get('id')}: no requiredDomains")
    return errs


if __name__ == '__main__':
    main()
