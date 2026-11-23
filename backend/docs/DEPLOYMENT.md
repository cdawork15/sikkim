# Team demo

> The current deployment is on AWS (Sydney) and updates on every push to `main`: see [deploy/aws/README.md](../../deploy/aws/README.md). This page describes the earlier, manually deployed team demo in another AWS account.

- Frontend: https://sikkim-experiences.dpcu7r1z2ixs4.amplifyapp.com
- Original URL / backend: https://15.252.155.73
- AWS Lightsail: `sikkim-demo`, Mumbai (`ap-south-1`), 2 GB, $12/month before tax and snapshots.
- Lightsail frontend fallback: `/var/www/sikkim`; backend: `/opt/sikkim/backend`.
- PostgreSQL: `sikkim_demo`, loopback only. Media: `/var/lib/sikkim/media`.
- Secrets: `/etc/sikkim/api.env` on the server; never commit or copy into frontend files.

SSH: `ssh -i ~/.ssh/sikkim-demo ubuntu@15.252.155.73` (firewall allows the deployment IP only).

```sh
sudo systemctl status sikkim-api nginx
sudo journalctl -u sikkim-api -n 50
curl --fail https://15.252.155.73/v1/health/ready
sudo /snap/bin/certbot renew --dry-run --no-random-sleep-on-renew
```

HTTPS certificates renew automatically. Database backups run daily at 02:30 UTC; Lightsail snapshots follow at 03:00 UTC. Database dumps are kept for roughly eight days in `/var/backups/sikkim`.

Deployment uses `NODE_ENV=production`, verified database TLS, and explicit `MEDIA_STORAGE_MODE=single_server`. Nginx serves HTTPS and proxies `/v1/` to port 3000 on loopback. General requests allow 600/minute per IP; stricter login/upload limits still apply.

Deployments are manual. Build the frontend with `VITE_DATA_MODE=api VITE_API_BASE_URL=/v1`; build the backend with Node 24. Back up before applying new database migrations. Restart `sikkim-api` after backend updates. Keep the temporary IP attached to avoid changing the URL.

The named frontend uses Amplify app `dpcu7r1z2ixs4`, branch `sikkim-experiences`, in Mumbai. Upload a ZIP of the built `dist` contents through a manual deployment. Keep `/v1/<*>` as an HTTPS rewrite to `https://15.252.155.73/v1/<*>` before the SPA fallback. Allow the exact Amplify origin in `FRONTEND_ORIGINS`. Amplify hosting adds usage-based storage and transfer charges.
