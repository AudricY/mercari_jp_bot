# Oracle Cloud VPS

## Instance

| Field | Value |
|---|---|
| Shape | VM.Standard.E2.1.Micro (Always Free) |
| Region | ap-singapore-1 |
| OS | Ubuntu 24.04 LTS |
| CPU / RAM / Disk | 2 vCPUs / 1 GB / 45 GB |
| Public IP | 161.118.204.72 |
| SSH | `ssh ubuntu@161.118.204.72` (`~/.ssh/id_ed25519`) |
| Hostname | `mercari-proxy-amd` |

## System Setup

- **Swap**: 2 GB at `/swapfile` (required — 1 GB RAM OOMs during Docker builds)
- **Docker**: Engine + Compose (official apt repo); app containers run from `ghcr.io/audricy/mercari-jp-bot:latest`
- **Docker log rotation**: `max-size: 10m`, `max-file: 3`
- **Unattended upgrades** and **Fail2ban** enabled
- **Tailscale**: not installed

## Firewall (iptables)

Oracle's default iptables has a REJECT-all rule at the end. Insert before it:

```bash
sudo iptables -L INPUT --line-numbers -n
sudo iptables -I INPUT <N> -p tcp --dport <PORT> -j ACCEPT
sudo netfilter-persistent save
```

Current instance `iptables` allows inbound **22**, **3000**, and **3001** before the final REJECT rule:

- **22**: SSH listens on all IPv4/IPv6 addresses. Password authentication is disabled, public key authentication is enabled, and Fail2ban has an `sshd` jail active.
- **3000**: Bot API is published by Docker as `0.0.0.0:3000->3000/tcp`. From the local workstation this timed out externally, likely because the OCI Security List does not allow it.
- **3001**: Analytics is published by Docker as `0.0.0.0:3001->3001/tcp` and was externally reachable on 2026-06-28, returning the analytics login page.

OCI Security List also needs ingress rules for external access.

## Current Compose Services

```text
mercari-app         ghcr.io/audricy/mercari-jp-bot:latest   0.0.0.0:3000->3000/tcp
mercari-analytics   ghcr.io/audricy/mercari-jp-bot:latest   0.0.0.0:3001->3001/tcp
```

The checked-out repo on the VPS was on `main` at `a37e770` on 2026-06-28, with local changes in `config.yaml` and an untracked `.env.bak.20260308173500`.
