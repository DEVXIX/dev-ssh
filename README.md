# SSH/FTP Manager/ Database Manager / Storage Server Manager / RDP Client

![Workspace Manager](https://i.imgur.com/KbqXrFl.png)

A web-based server manager with SSH terminal, file manager, database view/manage/export capabilities, S3 storage support, and RDP remote desktop - all self-hosted.

## Features

- **SSH Terminal** - Full terminal access to remote servers
- **File Manager** - Browse, upload, download files via SFTP
- **Database Manager** - View, manage, export databases (MySQL, PostgreSQL, SQLite, etc.)
- **Storage Manager** - S3-compatible storage (tested with MinIO)
- **RDP Client** - Remote desktop connections with NLA support (1920x1080)
- **Scheduled Tasks** - Cron jobs and automated script execution via SSH

## RDP Support

RDP connections use Apache Guacamole's guacd daemon for full NLA (Network Level Authentication) support.

### Requirements for RDP

1. Docker must be running
2. Start the guacd container:
   ```bash
   docker-compose up guacd -d
   ```

### How it works

- guacd container handles RDP protocol via FreeRDP (supports NLA)
- Backend connects to guacd on port 4822
- Frontend uses Guacamole protocol for display

## Scheduled Tasks (Cron Jobs)

Automate command execution on your servers with cron-based scheduling.

**Features:**
- Schedule any command or script using cron expressions
- Presets for common schedules (hourly, daily, weekly, monthly)
- Automatic SSH connection and execution
- Execution logs with output/error capture
- Manual "Run now" button for testing
- Enable/disable tasks
- Timezone support
- Run count tracking

**Example use cases:**
- Daily database backups: `pg_dump mydb > /backups/$(date +%Y%m%d).sql`
- Restart services: `systemctl restart nginx`
- Run cleanup scripts: `python3 /scripts/cleanup.py`
- System updates: `apt update && apt upgrade -y`

## Database Manager

Right click to view context menu, on tables or database.


## Storage Server Manager - Only tested with MiniO

## Installation

```bash
bun i or just docker compose up -d
```

## Usage

```bash
bun run dev or use it dockerized.
```

and you're ready to go!

## Database

This application uses SQLite for local data storage, 

## Env

ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)

## Suggestions

Create an issue to ask for more features if needed.

