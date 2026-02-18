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

## System Setup

- **Swap**: 2 GB at `/swapfile` (required — 1 GB RAM OOMs during Docker builds)
- **Docker**: Engine + Compose (official apt repo)
- **Docker log rotation**: `max-size: 10m`, `max-file: 3`
- **Unattended upgrades** and **Fail2ban** enabled

## Firewall (iptables)

Oracle's default iptables has a REJECT-all rule at the end. Insert before it:

```bash
sudo iptables -L INPUT --line-numbers -n
sudo iptables -I INPUT <N> -p tcp --dport <PORT> -j ACCEPT
sudo netfilter-persistent save
```

Open ports: **22** (SSH), **3000** (Bot API, localhost only).

OCI Security List also needs ingress rules for external access.
