# SSH/FTP Manager/ Database Manager / Storage Server Manager

![Workspace Manager](https://i.imgur.com/KbqXrFl.png)

idk what to call this but its a web-based server manager with ssh and file manager, database view/manage/export capabilities similar to termix. but it's a very old project i've worked on, the main purpose of it is to be self hosted, added s3 server storage support
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

