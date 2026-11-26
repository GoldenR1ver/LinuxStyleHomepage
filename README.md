# home

A personal homepage you read from a shell. After login, `ls`, `cat`, `grep`, and `find` open the pages, and `wget` downloads a file. The site is meant for GitHub Pages.

The shell is line-oriented and the commands live in one table. Day-to-day edits belong in `content/`, not in the terminal code.

## Run locally

```bash
npm install
npm test
npm run dev
```

Any username and password enters as a guest. `root` is the exception. The default root password is `123456`, set in `packages/core/src/config/site.ts`.

## Edit pages

Files in `content/` are the filesystem visitors see.

| On disk                           | In the shell             |
| --------------------------------- | ------------------------ |
| `content/home/owner/about.md`     | `/home/owner/about.md`   |
| `content/home/owner/projects/`    | projects                 |
| `content/home/owner/notes/`       | notes                    |
| `content/var/guestbook/about.txt` | guestbook instructions   |
| `content/etc/motd`                | line printed after login |
| `content/etc/issue`               | lines printed before login |

`issue` is expanded at the login prompt. `\n` is the hostname, `\l` is `tty1`, `\s` is `Linux`, `\S` is `PRETTY_NAME` from `os-release`, and `\e` or `\033` inserts the escape character used for color. A line break in the file is a real newline.

`site.owner` must match the directory name under `content/home/`. The default is `owner`. Root sees a `doctor` note when they differ.

Text files are markdown, `.txt`, and short files with no extension. PDF and images are binary: `cat` refuses them and `wget` downloads them. Text larger than 500KB is not inlined.

## What this repository contains

The published repository is the site: `content/` for the pages, `packages/core`
for the terminal and filesystem, `packages/web` for the browser view, and
`packages/cli` for the same core in a real terminal. Nothing else is versioned.

The process used to change the site lives in `local/`, which git ignores. A
clone gets no `intent/`, `spec/`, `tests/` or `uml/`, no gate scripts, and no
architecture documents: it is a working site, not a workflow.

## Continuous integration

`.github/workflows/deploy-pages.yml` runs three steps on every push to `main`:

```bash
npm ci        # installs from package-lock.json, fails if it is out of sync
npm test      # the package unit tests
npm run build # tsc --noEmit, then vite build
```

The build then uploads `dist/` to GitHub Pages. The gates are local only, so CI
does not run them; `npm run gate` does, on a machine that has `local/`.

## Machine settings

Edit only `packages/core/src/config/site.ts`:

- `rootPassword`: local gate. It is visible in the built bundle.
- `github`: repository, branch, and the content directory used when root commits. Default directory is `content`.
- `webhookUrl`: `mail push` relay. Empty means the letter stays in the visitor's browser. https only, and not a GitHub URL.
- `reportVisits`: off by default. When on, guest command digests are POSTed to the same URL.

`passwd` updates the password remembered in the current browser. It does not change this file.

## Permissions

Every file has an owner, a group, and mode bits (`rwx` for the owner, the group, and everyone else). `ls -l`, `stat`, and `tree -p` show them. `chmod` changes them. `chown` is root only.

Root ignores the mode bits. A guest is the owner when the user name matches, the group when the group name matches, and otherwise "other". Reaching a path also needs search permission (`x`) on each parent directory.

Shipped files are `0644` and directories are `0755`, owned by root. `/root` is `0700`. `/tmp` and `/var/guestbook` are `1777` (sticky): a guest may add a name, and may delete only a name they own. A scratch directory is `0700`, and files inside it are `0600`.

A guest write must also fall under `/tmp/<name>` or `/var/guestbook/`. Public pages stay unchanged even when a mode bit would allow the write. Guests cannot replace a file that shipped with the site, including `README.md` in the guestbook. Root writes outside `/tmp` are published.

|                               | guest                                              | root                   |
| ----------------------------- | -------------------------------------------------- | ---------------------- |
| read public files             | yes, while the mode bits allow it                  | yes                    |
| `/root`                       | no (`0700`)                                        | yes                    |
| `/tmp/<name>`                 | private to that user, this browser only            | writable, not uploaded |
| new file in `/var/guestbook/` | writable, this browser only, staged for `mail push` | committed to the repo  |
| edit about, notes, projects   | no                                                 | yes, via GitHub        |
| `chmod` / `chown`             | `chmod` on files they own                          | both, on any file      |

## Permissions are not access control

`chmod` changes a mode bit in this browser's overlay and nothing else. It is a
label that makes the terminal read like Linux; it is **not access control**.
Four facts, each checkable:

1. `chmod` writes only a mode. It queues no remote change, so `seal` commits
   nothing and the mode never leaves the browser.
2. The build stores no mode. `vite/content.ts` records path, size, mtime,
   encoding, and text, and `shippedMode` recomputes 0644/0755 on every load. A
   new visitor, or a redeploy, resets every bit.
3. The mode lives in this browser's IndexedDB overlay. Another browser starts
   from the same image with the same 0644.
4. Every published file is a static asset. `/fs/home/owner/about.txt` answers
   with the bytes over plain HTTP, whether or not the terminal would refuse to
   `cat` it.

Two consequences worth stating plainly:

- `chown` is not a fix either. Any name other than `root` logs in as a guest
  with that name and the password ignored, so `chown 600 owner` just means "log
  in as `owner`".
- `rootPassword` ships in the frontend bundle. It keeps honest visitors out of
  the editor; it does not protect a file.

Verify with the built manifest rather than with `ls -l`:

```bash
npm run build
node -e "const m=require('./dist/fs/manifest.json');console.log(m.files.filter(f=>/spec|intent|uml|test/.test(f.path)))"
# [] means nothing outside content/ was published
```

## Root publishes

1. Set `github.owner`, `github.repo`, and `github.branch` in `site.ts`.
2. Log in as root and run `github auth` with a token that can read and write Contents.
3. The token stays in this browser.
4. Later `echo`, `tee`, `mkdir`, `rm`, `cp`, `mv`, and text uploads with `scp` from root become one commit, message `homepage: <command>`.

Other visitors see the file after GitHub Pages redeploys. This browser sees it immediately. Without a token the command fails and the server file is unchanged.

## Guestbook and mail

```sh
cd /var/guestbook
vim your-name.txt
scp                        # choose local files to upload here
cp /home/owner/about.txt quote.txt
mv quote.txt about-quote.txt
mail --user you@example.com
mail -m "subject"
mail push
```

`scp` opens the browser's file chooser and copies the selected files into the current directory, or into the directory named by `scp <dir>`. Text up to 256 KB becomes a normal editable file. Larger or binary files up to 2 MB stay in the browser; `wget` downloads them, and the GitHub commit path does not publish them. `cp` and `mv` work on both kinds, so a guest can copy one of the published pages into the guestbook before mailing it.

`mail add` stages every text file in the local guestbook and `/tmp/<you>`. A piped note can mention another page; that page's contents are not attached.

```sh
echo "question" | mail add /home/owner/about.md
```

`mail --user you@example.com` records the guest's own address, and `mail push` refuses to send without one, so every letter can be answered. The address goes to the relay as `email`, which Formspree uses as Reply-To, and it is also written into the letter as `reply-to:`. `mail reset` and a finished send keep it; `mail --user ""` clears it. A letter body now starts:

```text
from: name
reply-to: you@example.com
```

The file stays in that browser. `mail push` POSTs one letter to `webhookUrl`. The command cannot pass a URL, a recipient, or the GitHub token. When the relay is set, the JSON includes Formspree fields:

```json
{
  "email": "you@example.com",
  "message": "to: you@example.com\nfrom: name\nreply-to: you@example.com\n\n--- /var/guestbook/your-name.txt\nnote body",
  "_subject": "[home] subject",
  "_gotcha": "",
  "type": "letter",
  "path": "/var/guestbook/your-name.txt",
  "user": "name"
}
```

The endpoint must allow browser CORS. The form's own recipient is who gets the mail. Other visitors cannot read the note, and it is not committed. If the relay is missing or the request fails, the shell says so and the draft remains. The failure line carries the relay status, for example `mail: delivery failed (403: form needs confirmation)`.

A Formspree form must be confirmed in its dashboard before it accepts letters, and the free plan allows 50 a month. `webhookUrl` is the only setting: `mail push` cannot change the URL, the recipient, or read the GitHub token.

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

Append an entry in the matching file under `packages/core/src/shell/commands/`:

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

`help`, `man`, and completion read that table. File changes go through `ctx.rt.fs` while the shell transaction is open. Guest write rules are in `packages/core/src/kernel/policy.ts`. The mode bits shown by `ls -l` are labels.

## Layout

```text
content/                 pages visitors can cat, and the only published tree
packages/core/           terminal, filesystem, shell, remote, panes: no DOM
packages/web/            the browser view: terminal, styling, IndexedDB adapter
packages/cli/            the same core in a real terminal
vite/content.ts          packs content/ into the site, and nothing else
package.json             workspace root; dev, build, test, gate
tsconfig.json            one project over packages/ and vite/
```

`packages/core` never imports `packages/web`, and nothing in it touches
`window`, `document`, `localStorage` or `indexedDB`. A host supplies an image, a
`Store` and an `http` function; the browser and the CLI each supply their own.

`local/` holds the workflow used to change the site (intent, spec, the decision
table, the invariants, three UML diagrams, the gates and the gate tests). It is
git-ignored on purpose: it never ships, and a clone does not have it.

```bash
npm run cli -- ls /home/owner     # the core shell, in this terminal
npm run gate                      # the local gates; needs local/
```

## Limits

- The root password is not authentication. Remote writes trust the GitHub token in this browser. `mail push` does not use that token.
- Guest drafts, the reply address, and guestbook notes live in the browser. Another computer does not have them. The owner reads a pushed letter in the relay mailbox and can answer it at the guest's address.
- There is no command substitution, no background jobs, and no full VT100 emulator.
- Binary files can be downloaded. Root cannot edit or publish them from the shell. `scp` keeps uploaded binaries in this browser. Replace the file under `content/` and rebuild to publish one.
