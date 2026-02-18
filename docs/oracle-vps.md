# Oracle Cloud VPS

## Instance Details

| Field | Value |
|---|---|
| Name | mercari-proxy-amd |
| Shape | VM.Standard.E2.1.Micro (Always Free) |
| Region | ap-singapore-1 |
| Availability Domain | iHXM:AP-SINGAPORE-1-AD-1 |
| OS | Ubuntu 24.04.3 LTS |
| CPU | 2 vCPUs (AMD EPYC 7742) |
| RAM | 1 GB |
| Disk | 45 GB |
| Public IP | 161.118.204.72 (reserved) |
| Private IP | 10.0.1.132 |
| Instance OCID | ocid1.instance.oc1.ap-singapore-1.anzwsljrj26sjhycj6nqdosdrv6fehd6brlxg62nw3r5vsma4jy2tptnmbsa |

## SSH Access

```bash
ssh ubuntu@161.118.204.72
```

Uses `~/.ssh/id_ed25519` key (injected at provisioning).

## System Setup

- **Swap**: 2 GB at `/swapfile` (required — 1 GB RAM will OOM during Docker builds)
- **Docker**: Docker Engine + Compose (official apt repo, not snap)
- **Docker log rotation**: `/etc/docker/daemon.json` — `max-size: 10m`, `max-file: 3`
- **Unattended upgrades**: enabled for automatic security patches
- **Fail2ban**: enabled for SSH brute-force protection

## Networking

| Resource | OCID |
|---|---|
| VCN | ocid1.vcn.oc1.ap-singapore-1.amaaaaaaj26sjhyasydaq45dgb2e6hkvazrqmjoyhib26uei423hqffdc3za |
| Subnet | ocid1.subnet.oc1.ap-singapore-1.aaaaaaaayuhuctorqnpmcev3qdymoowtmx2j2oywtc73ns22o2bbrcytwkpa |
| Internet Gateway | ocid1.internetgateway.oc1.ap-singapore-1.aaaaaaaagw5n52pdc4nezffnygkavb47gigg27gcai4g7dqa2dteuuyy4hnq |

### Firewall (iptables)

Oracle's default iptables has a REJECT-all rule at the end. Open ports must be inserted **before** it:

```bash
# Check current rules and find the REJECT rule number
sudo iptables -L INPUT --line-numbers -n

# Insert before the REJECT rule (adjust N)
sudo iptables -I INPUT <N> -p tcp --dport <PORT> -j ACCEPT
sudo netfilter-persistent save
```

Currently open ports:
- **22** — SSH
- **3000** — Bot API (health checks, admin endpoints)

### OCI Security List

The OCI Security List also needs ingress rules for any ports you want accessible from outside the VPS. Port 22 is open by default. Port 3000 can be added if external access is needed (currently only accessed from localhost).

## OCI CLI Config

Config file: `~/.oci/config`
API key: `~/.oci/oci_api_key.pem`
