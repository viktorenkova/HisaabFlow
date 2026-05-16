# HisaabFlow Web Deploy For Laragon

Expected server folder:

```text
C:\laragon\www\hisaabflow-web
```

Expected contents:

```text
backend\
configs\
public\
scripts\
```

`public` is the only folder that Apache should expose as `DocumentRoot`.

## First Setup

Open PowerShell on the server:

```powershell
cd C:\laragon\www\hisaabflow-web
powershell -ExecutionPolicy Bypass -File .\scripts\install-backend-deps.ps1
```

## Start Backend

Keep this PowerShell window open:

```powershell
cd C:\laragon\www\hisaabflow-web
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
```

Check backend:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-backend.ps1
```

## Apache

Copy `scripts\apache-vhost-hisaabflow.conf` into Laragon's Apache virtual host config area or paste its contents into the active Apache config.

Required Apache modules:

```text
proxy_module
proxy_http_module
headers_module
rewrite_module
```

Restart Apache after config changes.

## Browser Checks

```text
http://217.150.200.67/health
http://217.150.200.67/
```

