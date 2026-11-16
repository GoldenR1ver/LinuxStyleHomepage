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
| `content/var/guestbook/about.txt` | guestbook instructions   |
| `content/etc/motd`                | line printed after login |
| `content/etc/issue`               | lines printed before login |

`issue` is expanded at the login prompt. `\n` is the hostname, `\l` is `tty1`, `\s` is `Linux`, `\S` is `PRETTY_NAME` from `os-release`, and `\e` or `\033` inserts the escape character used for color. A line break in the file is a real newline.

`site.owner` must match the directory name under `content/home/`. The default is `owner`. Root sees a `doctor` note when they differ.

Text files are markdown, `.txt`, and short files with no extension. PDF and images are binary: `cat` refuses them and `wget` downloads them. Text larger than 500KB is not inlined.

## Specgate architecture

This repository carries one live round of the SpecgateWorkflow as an architecture document, not as a feature of the site. `intent/`, `spec/`, `tests/`, `uml/`, and `tools/gates/` hold the nine steps; nothing in them is published.

The site's filesystem is built from `content/` alone. There is no mount table, no `specgate` command, and no entry in `motd` or `issue`: a visitor sees exactly the pages the homepage had before this architecture existed.

Why keep it in the repository at all: it is the process the owner uses to change the site. A round starts by editing `intent/intent.yaml`, flows through spec, the decision table, and the invariants, and is judged by six gates.

```bash
node tools/gates/run.mjs     # the six document gates
npm test                     # the suite, including each gate's negative test
```

| Gate | Placement | Subject |
| --- | --- | --- |
| `G-WORD-01` | pre-commit | vague words in `intent/` and `spec/` |
| `G-DRAFT-01` | pre-commit | a draft that leaked into `content/` |
| `G-REF-01` | pre-commit | paths in `spec/`, `tests/MANIFEST.yaml`, `uml/` |
| `G-INV-01` | pr | every constraint in `spec/const.yaml` has a check |
| `G-DEP-01` | pr | `src/kernel` never imports an upper layer |
| `G-DT-01` | merge | `DT-PUBLISH` has no gap, overlap, or dead row |
| `G-TEST-01` | merge | the suite is green and not empty |

`DT-PUBLISH` is the table that decides a file's fate at build time: only `content/` reaches `dist/fs`. Publishing anything else would need a new row there, and `G-DT-01` would catch its absence.

## Continuous integration

`.github/workflows/deploy-pages.yml` runs three steps on every push to `main`:

```bash
npm ci        # installs from package-lock.json, fails if it is out of sync
npm test      # the whole suite, which itself runs the six document gates
npm run build # tsc --noEmit, then vite build, which stops on G-DRAFT-01
```

The build then uploads `dist/` to GitHub Pages. The workflow itself is unchanged by this architecture: the gates ride inside `npm test`, because `tests/gates/test_gate_suite.test.ts` spawns `tools/gates/run.mjs`.

## Machine settings

Edit only `src/config/site.ts`:

- `rootPassword`: local gate. It is visible in the built bundle.
- `github`: repository, branch, and the content directory used when root commits. Default directory is `content`.
- `webhookUrl`: `mail push` relay. Empty means the letter stays in the visitor's browser. https only, and not a GitHub URL.
- `reportVisits`: off by default. When on, guest command digests are POSTed to the same URL.
- `journalDays`: how long the log and rollback window last. Default 7.

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
| `rollback`                    | no                                                 | yes                    |

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

## Drafts

Unfinished work goes in `drafts/` at the repository root, never in `content/`.
That directory is ignored by git except for its own `README.txt`, and the build
refuses a draft that leaked into `content/`, so a draft has no URL at all.

```text
drafts/*            ignored
drafts/README.txt   tracked, explains the rule
```

A draft starts with one marker line:

```text
DRAFT: unpublished
```

`G-DRAFT-01` fails the build when a text file under `content/` carries that
marker in its first five lines, or when a path segment under `content/` is named
`drafts`. `npm run dev` prints the same finding as a warning so you see it before
you push. Publishing therefore takes a deliberate act: copy the draft into
`content/` and delete the marker line.

```bash
node tools/gates/draftCheck.mjs   # the same check, on demand
npm run build                     # stops with G-DRAFT-01 if a draft leaked
```

Verify with the built manifest rather than with `ls -l`:

```bash
npm run build
node -e "const m=require('./dist/fs/manifest.json');console.log(m.files.filter(f=>/draft|spec|intent|uml/.test(f.path)))"
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
content/                 pages visitors can cat, and the only published tree
drafts/                  local drafts: git-ignored, never published
intent/                  one round: intent.yaml, prototype.md
spec/                    spec, const, decision table, gates
tests/                   suite grouped by oracle, plus MANIFEST.yaml
uml/                     state, sequence and dependency diagrams
tools/gates/             one judgment script per gate
src/config/site.ts       password, GitHub, mail
src/kernel/              paths, policy, filesystem, log
src/shell/               parser and commands
src/remote/              GitHub commits and mail
src/mux/                 pane layout
src/ui/                  terminal view
vite/content.ts          packs content/ into the site, and nothing else
```

## Limits

- The root password is not authentication. Remote writes trust the GitHub token in this browser. `mail push` does not use that token.
- Guest drafts, the reply address, guestbook notes, and the log live in the browser. Another computer does not have them. The owner reads a pushed letter in the relay mailbox and can answer it at the guest's address.
- There is no command substitution, no background jobs, and no full VT100 emulator.
- Binary files can be downloaded. Root cannot edit or publish them from the shell. `scp` keeps uploaded binaries in this browser. Replace the file under `content/` and rebuild to publish one.
