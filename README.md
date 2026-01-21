# SSH/FTP Manager/ Database Manager / Storage Server Manager / RDP Client

![Workspace Manager](https://i.imgur.com/KbqXrFl.png)

A web-based server manager with SSH terminal, file manager, database view/manage/export capabilities, S3 storage support, and RDP remote desktop - all self-hosted.

## Features

- **SSH Terminal** - Full terminal access to remote servers
- **File Manager** - Browse, upload, download files via SFTP
- **Database Manager** - View, manage, export databases (MySQL, PostgreSQL, SQLite, etc.)
- **Storage Manager** - S3-compatible storage (tested with MinIO)
- **RDP Client** - Remote desktop connections with NLA support (1920x1080)

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

