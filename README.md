# home

A personal homepage you read from a shell. After login, `ls`, `cat`, `grep`, and `find` open the pages, and `wget` downloads a file. The site is meant for GitHub Pages.

The shell is line-oriented and the commands live in one table. Day-to-day edits belong in `content/`, not in the terminal code.

## Run locally

```bash
npm install
npm test
npm run dev
```

Any username and password enters as a guest. `root` is the exception. The default root password is `123456`, set in `src/config/site.ts`.

## Edit pages

Files in `content/` are the filesystem visitors see.

| On disk                           | In the shell             |
| --------------------------------- | ------------------------ |
| `content/home/owner/about.md`     | `/home/owner/about.md`   |
| `content/home/owner/projects/`    | projects                 |
| `content/home/owner/notes/`       | notes                    |
| `content/var/guestbook/README.md` | guestbook note           |
| `content/etc/motd`                | line printed after login |
| `content/etc/issue`               | lines printed before login |

`issue` is expanded at the login prompt. `\n` is the hostname, `\l` is `tty1`, `\s` is `Linux`, `\S` is `PRETTY_NAME` from `os-release`, and `\e` or `\033` inserts the escape character used for color. A line break in the file is a real newline.

`site.owner` must match the directory name under `content/home/`. The default is `owner`. Root sees a `doctor` note when they differ.

Text files are markdown, `.txt`, and short files with no extension. PDF and images are binary: `cat` refuses them and `wget` downloads them. Text larger than 500KB is not inlined.

## Machine settings

Edit only `src/config/site.ts`:

- `rootPassword`: local gate. It is visible in the built bundle.
- `github`: repository, branch, and the content directory used when root commits. Default directory is `content`.
- `webhookUrl`: `mail push` relay. Empty means the letter stays in the visitor's browser. https only, and not a GitHub URL.
- `reportVisits`: off by default. When on, guest command digests are POSTed to the same URL.
- `journalDays`: how long the log and rollback window last. Default 7.

`passwd` updates the password remembered in the current browser. It does not change this file.

## Permissions

|                               | guest                                              | root                   |
| ----------------------------- | -------------------------------------------------- | ---------------------- |
| read public files             | yes                                                | yes                    |
| `/tmp/<name>`                 | writable, this browser only                        | writable, not uploaded |
| new file in `/var/guestbook/` | writable, this browser only, staged for `mail push` | committed to the repo  |
| edit about, notes, projects   | no                                                 | yes, via GitHub        |
| `rollback`                    | no                                                 | yes                    |

Guests cannot overwrite a published file, including `README.md` in the guestbook.

## Root publishes

1. Set `github.owner`, `github.repo`, and `github.branch` in `site.ts`.
2. Log in as root and run `github auth` with a token that can read and write Contents.
3. The token stays in this browser.
4. Later `echo`, `tee`, `mkdir`, `rm`, `cp`, and `mv` from root become one commit, message `homepage: <command>`.

Other visitors see the file after GitHub Pages redeploys. This browser sees it immediately. Without a token the command fails and the server file is unchanged.

## Guestbook and mail

```sh
vim /var/guestbook/your-name.txt
mail -m "subject"
mail push
```

`mail add` stages every text file in the local guestbook and `/tmp/<you>`. A piped note can mention another page; that page's contents are not attached.

```sh
echo "question" | mail add /home/owner/about.md
```

The file stays in that browser. `mail push` POSTs one letter to `webhookUrl`. The command cannot pass a URL, a recipient, or the GitHub token. When the relay is set, the JSON includes Formspree fields:

```json
{
  "email": "name@homepage.local",
  "message": "to: you@example.com\nfrom: name\n\n--- /var/guestbook/your-name.txt\nnote body",
  "_subject": "[home] subject",
  "_gotcha": "",
  "type": "letter",
  "path": "/var/guestbook/your-name.txt",
  "user": "name"
}
```

The endpoint must allow browser CORS. The form's own recipient is who gets the mail. Other visitors cannot read the note, and it is not committed. If the relay is missing or the request fails, the shell says so and the draft remains.

## Log and rollback

Every login and command is stored in this browser. Each root create, update, or delete also stores the previous contents.

```sh
journal
journal -m
rollback
rollback <id>
rollback --last
```

Records older than `journalDays` are dropped. Rolling back a published file needs the token. Activity from someone else's browser never appears here.

## Panes

A session is already attached after login. `Ctrl-b` then:

| Key            | Action                 |
| -------------- | ---------------------- |
| `%`            | split left/right       |
| `"`            | split up/down          |
| arrows or hjkl | move                   |
| `x`            | close pane             |
| `c`            | new window             |
| `n` / `p`      | next / previous window |
| `0-9`          | select window          |

Each pane has its own directory, user, and history. `su` affects the current pane. `exit` closes it, and the last pane returns to login. `logout` returns immediately. `tmux split-window -h` and `tmux ls` work too. `help` prints the same map.

## Deploy

Push this directory as the repository root. In Settings, Pages, Source, choose GitHub Actions. `.github/workflows/deploy-pages.yml` tests, builds, and publishes.

`base` is `./`, so both a user site and a project site work. A root commit under `content/` triggers another deploy.

## Add a command

Append an entry in the matching file under `src/shell/commands/`:

```ts
{
  name: 'hello',
  group: 'site',
  summary: 'say hello',
  usage: 'hello',
  manual: 'Print one line.',
  run: () => ({ code: 0, stdout: 'hello\n' }),
}
```

`help`, `man`, and completion read that table. File changes go through `ctx.rt.fs` while the shell transaction is open. Guest write rules are in `src/kernel/policy.ts`. The mode bits shown by `ls -l` are labels.

## Layout

```text
content/                 pages visitors can cat
src/config/site.ts       password, GitHub, mail
src/kernel/              paths, policy, filesystem, log
src/shell/               parser and commands
src/remote/              GitHub commits and mail
src/mux/                 pane layout
src/ui/                  terminal view
vite/content.ts          packs content/ into the site
```

## Limits

- The root password is not authentication. Remote writes trust the GitHub token in this browser. `mail push` does not use that token.
- Guest drafts, guestbook notes, and the log live in the browser. Another computer does not have them. The owner reads a pushed letter in the relay mailbox.
- There is no command substitution, no background jobs, and no full VT100 emulator.
- Binary files can be downloaded. Root cannot edit them from the shell. Replace the file under `content/` and rebuild.
