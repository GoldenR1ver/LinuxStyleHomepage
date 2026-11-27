# Home Linux —— 设计报告

> 一台跑在浏览器标签页里的 Linux 小机器：`content/` 是硬盘，`packages/core` 是内核与 shell，`packages/web` 是终端显示器，`packages/cli` 是同一台机器的另一个屏幕。没有服务端，因此「后端」被拆成了几个可替换的端口。

当前规模：`packages/core` 51 个 TypeScript 文件，`packages/web` 21 个；**50 个内建命令**；**32 个测试文件 / 211 个用例**；`tsc --noEmit` 与 `vite build` 干净。

---

## 目录

1. [总体结构](#1-总体结构)
2. [文件系统](#2-文件系统)
3. [权限管理](#3-权限管理)
4. [终端](#4-终端)
5. [前端渲染分离](#5-前端渲染分离)
6. [与 Linux 原生的异同](#6-与-linux-原生的异同)
7. [已知边界](#7-已知边界)

---

## 1. 总体结构

```text
content/ ──vite/content.ts──> dist/fs/manifest.json ──load.ts──> Map<path,Node>   image
                                                                                   │
IndexedDB ─────────────────────────────────────────────────────> Map<path,Entry>   local
                                                                                   │
/proc ──────────────────────────────────────────────────────> 读取时生成            synthetic
                                                                                   ▼
                                                                              VirtualFS
                                                                                   │
           终端输入 ──parser──> expand ──> runner ──> commands/*.ts ──> CommandResult
                                                                                   │
                                        ┌──────────────────────────────────────────┤
                                        ▼                                          ▼
                                TermView（DOM）                            persist() → IndexedDB
```

三条依赖规则，都由类型系统保证：

| 规则 | 证据 |
| --- | --- |
| `core` 不 import `web` | `packages/core/package.json` 的 `description` 与 `tsconfig.json` 的 `paths` |
| `core` 不碰 DOM / IndexedDB / localStorage | 全靠端口注入（`Runtime` / `Host` / `Store`） |
| `web` 与 `cli` 共用同一个 `core` | 两者都只 `dependencies: { "@home/core": "*" }` |

三个宿主，三个装配点：

| 宿主 | 文件 | 替换了什么 |
| --- | --- | --- |
| 浏览器 | `packages/web/src/main.ts` | IndexedDB、`localStorage`、Formspree、`TermView` |
| Node CLI | `packages/cli/src/main.ts` | 真实 `content/` 目录、`readline`、内存 mailer |
| 测试 | `packages/core/src/testkit.ts` | 内存镜像 + 内存 mailer + 假 Host |

---

## 2. 文件系统

### 2.1 三种路径，一个查找函数

`VirtualFS` 有三种完全不同的路径来源：

```text
image      构建产物，只读，所有人共享
local      这个浏览器写的，可写，刷新后仍在
synthetic  读取时才生成，不占一个字节（/proc）
```

查找顺序是 `local → image → synthetic`，墓碑截断下层：

```561:575:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/vfs.ts
  private lookup(path: string): { node: Node | null; from: 'local' | 'image' | 'none' } {
    const local = this.local.get(path)
    if (local?.type === 'tomb') return { node: null, from: 'local' }
    if (local) return { node: local, from: 'local' }
    const image = this.image.get(path)
    if (image) return { node: image, from: 'image' }
    return { node: null, from: 'none' }
  }
```

合成层在读取侧参与，写入侧永远拒绝：

```575:592:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/vfs.ts
  /** The node a reader sees, including the synthetic tree that owns no bytes. */
  private visibleFor(user: User, path: string): Node | null {
    const plain = this.visible(path)
    if (plain) return plain
    const synthetic = this.synthetic
    if (!synthetic) return null
    const content = synthetic.file(path, user)
    if (content !== null) {
      return {
        type: 'file',
        content,
        encoding: 'utf8',
        size: byteLength(content),
        mtime: Date.now(),
        mode: 0o444,
```

```137:143:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/vfs.ts
  private refuseSynthetic(path: string) {
    const root = this.synthetic?.root
    if (!root) return
    if (path === root || path.startsWith(`${root}/`)) {
      throw new FsError('EROFS', 'Read-only file system')
    }
  }
```

### 2.2 `/proc`：文件的第三个来源

`/proc` 里没有字节。每次读，内容才被算出来：

```1:12:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/proc.ts
/**
 * `/proc`: the third kind of path.
 *
 * `image` is bytes compiled into the build, `local` is bytes this browser wrote,
 * and `/proc` is bytes that do not exist until someone reads them. A synthetic
 * filesystem answers two questions — which names are in a directory, and what a
 * file says — and the VFS plugs it in beside the other two layers. Nothing is
 * stored, nothing is persisted, and a write is refused, exactly as on Linux.
 */
```

接口只有两个方法，恶意地小：

```28:36:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/proc.ts
export interface Synthetic {
  /** The directory this filesystem owns, such as `/proc`. */
  readonly root: string
  /** Names in a synthetic directory, or null when the path is not one. */
  list(path: string, user: User): string[] | null
  /** Content of a synthetic file, or null when the path is not one. */
  file(path: string, user: User): string | null
}
```

`/proc/self/status` 之所以是「self」，是因为它知道读它的人是谁：

```84:98:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/proc.ts
function status(user: User, source: ProcSource): string {
  const rows = [
    `Name:\t${user.name}`,
    'State:\tR (running)',
    'Tgid:\t1',
    'Pid:\t1',
    `PPid:\t0`,
    `Uid:\t${user.uid}\t${user.uid}\t${user.uid}\t${user.uid}`,
    `Gid:\t${user.gid}\t${user.gid}\t${user.gid}\t${user.gid}`,
    `Groups:\t${user.groups.join(' ')}`,
```

挂载表也是它生成的，于是 `mount`、`df`、`/proc/mounts` 三处说法永远一致：

```14:33:D:/LEARNING_RESOURCE/HomePage/packages/core/src/app/system.ts
export function installProc(rt: Runtime) {
  rt.fs.setSynthetic(
    new ProcFS({
      hostname: rt.site.hostname,
      release: '6.1-home',
      machine: 'x86_64',
      boot: Date.now(),
      procs: () => rt.procs(),
      mounts: () => mountTable(),
    }),
  )
  // A tmpfs holds nothing across a reboot, and neither does this.
  rt.fs.markEphemeral('/tmp')
}

export function mountTable(): MountRow[] {
  return [
    { device: 'content', dir: '/', type: 'overlay', options: 'rw,lowerdir=/image,upperdir=local' },
    { device: 'proc', dir: '/proc', type: 'proc', options: 'ro,nosuid,nodev,noexec' },
    { device: 'tmpfs', dir: '/tmp', type: 'tmpfs', options: 'rw,nosuid,nodev,size=64m' },
  ]
}
```

`mount` 的实际输出：

```text
content on / type overlay (rw,lowerdir=/image,upperdir=local)
proc on /proc type proc (ro,nosuid,nodev,noexec)
tmpfs on /tmp type tmpfs (rw,nosuid,nodev,size=64m)
```

### 2.3 元数据在构建期就定好

静态构建只存字节。所以 mode / uid / gid 在**构建时**算一次，写进 manifest，浏览器只做解包：

```63:90:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/perm.ts
export function buildMetadata(entries: MetaEntry[], read: (path: string) => string | null): Map<string, Meta> {
  const accounts = parsePasswd(read('/etc/passwd') ?? '')
  const groups = parseGroup(read('/etc/group') ?? '')
  const present = new Set(entries.map((entry) => entry.path))
  const meta = new Map<string, Meta>()

  for (const entry of entries) {
    meta.set(entry.path, { mode: shippedMode(entry.path, entry.kind), uid: 'root', gid: 'root' })
  }

  // A home that ships in the tree belongs to its account, not to root.
  for (const home of planHomes(accounts, groups)) {
    if (present.has(home.path)) meta.set(home.path, { mode: home.mode, uid: home.uid, gid: home.gid })
  }

  // An explicit line wins over both defaults, which is how /bin/passwd gets 4755.
  for (const line of parsePerm(read('/etc/perm') ?? '')) {
    if (!present.has(line.path)) continue
    const current = meta.get(line.path) ?? { mode: 0o644, uid: 'root', gid: 'root' }
    meta.set(line.path, {
      mode: line.mode ?? current.mode,
      uid: line.uid,
      gid: line.gid,
    })
  }

  return meta
}
```

构建产物的样子（实测）：

```text
/etc/passwd                file 0644 root:root
/etc/shadow                file 0600 root:root
/bin/passwd                file 4755 root:root    ← /etc/perm
/home/ada                  dir 0700 ada:ada       ← /etc/passwd
/home/owner                dir 0755 owner:staff   ← /etc/perm
/srv/reading-room          dir 0750 root:readers
```

浏览器侧因此不需要再推导所有权，只是把元数据抄进 inode：

```35:45:D:/LEARNING_RESOURCE/HomePage/packages/web/src/content/load.ts
    if (file.type === 'dir') {
      image.set(file.path, dir(file.mode, file.uid, file.gid))
      continue
    }
    const node: FileNode = {
      ...
      mode: file.mode,
      uid: file.uid,
      gid: file.gid,
    }
```

### 2.4 事务：可嵌套，所以 `sudo` 能存在

每条命令一个事务，失败整体回滚：

```138:139:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/runner.ts
  ctx.rt.fs.begin()
  try {
```

事务是**栈**而不是单一锁，因此「命令内部再跑一次 shell」是合法的：

```124:136:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/vfs.ts
  /**
   * Transactions nest. Each `begin` takes a snapshot and each `abort` restores it,
   * so a command that calls the shell again (sudo) cannot overflow a global lock.
   */
  begin() {
    this.stack.push(this.snapshot())
  }
```

### 2.5 会话级路径

`ephemeral` 是一个「刷新即忘」的标记集合，用来实现两件事：未知用户的账户，以及 tmpfs：

```90:95:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/vfs.ts
  isEphemeral(path: string): boolean {
    const value = normalize(path)
    return this.ephemeral.some((prefix) => value === prefix || value.startsWith(`${prefix}/`))
  }
```

`exportLayer()` 会过滤掉它们，所以它们永远进不了 IndexedDB。

---

## 3. 权限管理

### 3.1 DAC：三类位 + 补充组 + 路径搜索

```8:24:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/policy.ts
/**
 * The POSIX permission check: owner, then a supplementary group, then other.
 * A process holding CAP_DAC_OVERRIDE skips the bits, which is how root gets its
 * power without a special case here.
 */
export function modePermits(
  user: User,
  node: { mode: number; uid: string; gid: string },
  bit: 1 | 2 | 4,
): boolean {
  if (hasCap(user, 'CAP_DAC_OVERRIDE')) return true
  const owner = node.uid === user.name
  const group = !owner && user.groups.includes(node.gid)
  const klass = owner ? node.mode >> 6 : group ? node.mode >> 3 : node.mode
  return (klass & bit) !== 0
}
```

**注意这一行 `hasCap(user, 'CAP_DAC_OVERRIDE')`** —— 它取代了原来的 `user.uid === 0`。整个内核现在没有一处「因为你是 root」的魔法分支。

父目录的 `x`（search）是单独一层，很多玩具 shell 会漏掉：

```513:524:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/vfs.ts
  private assertSearch(user: User, path: string) {
    // CAP_DAC_READ_SEARCH is exactly "read and search without the mode bits".
    if (hasCap(user, 'CAP_DAC_READ_SEARCH') || hasCap(user, 'CAP_DAC_OVERRIDE')) return
    for (const dir of parentChain(path)) {
      if (dir === path) break
      const node = this.visibleFor(user, dir)
      if (!node) throw new FsError('ENOENT', 'No such file or directory')
      if (node.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
      if (!modePermits(user, cred(node), 1)) throw new FsError('EACCES', 'Permission denied')
    }
  }
```

粘滞位只限制删除，不限制创建：

```548:556:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/vfs.ts
    if ((parent.mode & 0o1000) === 0) return
    const node = this.visible(path)
    if (!node) return
    if (node.uid === user.name || parent.uid === user.name) return
    throw new FsError('EACCES', 'Permission denied')
```

### 3.2 capabilities：把 root 拆成八个开关

```1:23:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/caps.ts
/**
 * Linux capabilities, cut down to the ones this kernel actually consults.
 *
 * `uid 0` used to be a single magic branch: "root may do anything". Linux has
 * not worked that way for twenty years. A process carries a set of capabilities,
 * and each privileged operation asks for one of them. An account with uid 0 gets
 * all of them, which is why root still behaves like root; an account with one
 * extra capability gets exactly that one power.
 */
export const CAPABILITIES = [
  'CAP_CHOWN',
  'CAP_DAC_OVERRIDE',
  'CAP_DAC_READ_SEARCH',
  'CAP_FOWNER',
  'CAP_FSETID',
  'CAP_SETGID',
  'CAP_SETUID',
  'CAP_SYS_ADMIN',
] as const
```

每个特权操作只问一个开关：

| 操作 | 需要的 capability | 代码位置 |
| --- | --- | --- |
| 读任意文件 / 穿任意目录 | `CAP_DAC_READ_SEARCH` | `vfs.mayRead` / `assertSearch` |
| 写任意文件 | `CAP_DAC_OVERRIDE` | `policy.modePermits` |
| `chown` | `CAP_CHOWN` | `vfs.chown` |
| `chmod` 别人的文件 | `CAP_FOWNER` | `vfs.chmod` |
| 写文件后保留 setuid | `CAP_FSETID` | `vfs.write` |
| `su` / `sudo` / `passwd <other>` | `CAP_SETUID` | `system.ts` |

「读得到、改不了」是 `CAP_DAC_READ_SEARCH` 与 `CAP_DAC_OVERRIDE` 的分界线：

```266:273:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/vfs.ts
  /**
   * CAP_DAC_READ_SEARCH is "read anything, change nothing": it bypasses the read
   * bit and the directory search bit, but never the write bit. A backup account
   * wants exactly this, which is why it exists as its own capability.
   */
  private mayRead(user: User, node: Node): boolean {
    return modePermits(user, cred(node), 4) || hasCap(user, 'CAP_DAC_READ_SEARCH')
  }
```

非 root 的 capability 来自 `/etc/caps`，与账户一样是内容而不是代码：

```text
# /etc/caps
backup:CAP_DAC_READ_SEARCH
```

于是 `backup` 这个非 root 账户能 `cat /root/README.md`，但 `echo x > /root/README.md` 会失败。这正是「备份账号」在真实系统上的形态。`capsh` 把集合打出来：

```text
$ capsh
Current: uid=0(root)
+cap_chown
+cap_dac_override
+cap_dac_read_search
+cap_fowner
+cap_fsetid
+cap_setgid
+cap_setuid
+cap_sys_admin
```

### 3.3 setuid：exec 时换 euid

执行命令前查 `PATH`，命中 setuid 可执行文件就换身份：

```206:222:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/runner.ts
function execIdentity(ctx: ShellCtx, name: string): User | null {
  for (const dir of (ctx.env.PATH ?? '/bin').split(':').filter(Boolean)) {
    const path = `${dir}/${name}`
    let stat
    try {
      stat = ctx.rt.fs.stat(ctx.user, path)
    } catch {
      continue
    }
    if (stat.type !== 'file') continue
    if ((stat.mode & 0o4000) === 0 || (stat.mode & 0o111) === 0) continue
    if (stat.uid === ctx.user.name) continue
    const owner = lookupUser(ctx.rt.fs, stat.uid)
    if (owner) return owner
  }
  return null
}
```

提升只围绕那一次 `run`，结束立刻还回去：

```177:187:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/runner.ts
    const elevated = execIdentity(ctx, name)
    const previous = ctx.user
    let result
    try {
      if (elevated) ctx.user = elevated
      result = await spec.run(ctx, args.slice(1), stdin)
    } finally {
      if (elevated) ctx.user = previous
    }
```

为此 `ShellCtx` 区分了 `user`（euid）与 `realUser`（ruid），就是 `geteuid` 与 `getuid`：

```67:74:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/context.ts
export interface ShellCtx {
  /** The effective identity. A setuid binary elevates this for one command. */
  user: User
  /** The identity that logged in. `passwd` and `sudo` read this, never `user`. */
  realUser: User
```

写入会清掉 setuid/setgid（除非有 `CAP_FSETID`），和真实内核一致：

```277:283:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/vfs.ts
    // A write by anyone without CAP_FSETID clears setuid and setgid, the way the
    // kernel does: a modified binary must not keep its privilege.
    const inherited = prior
      ? hasCap(user, 'CAP_FSETID')
        ? prior.mode
        : prior.mode & ~0o6000
      : createdMode('file', this.umask)
```

---

## 4. 终端

### 4.1 一行命令的生命周期

```27:42:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/runner.ts
export async function runLine(line: string, ctx: ShellCtx): Promise<CommandResult> {
  const definition = readDefinition(line)
  if (definition) {
    if ('error' in definition) return { code: 2, stderr: `sh: ${definition.error}\n` }
    return define(ctx, definition.name, definition.body)
  }
  ctx.line = line
  ctx.reexec = (next) => runLine(next, ctx)
  let parsed
  try {
    parsed = parse(expandAlias(line, ctx.aliases))
  } catch (err) {
    return { code: 2, stderr: `sh: ${message(err)}\n` }
  }
  if (!parsed.items.length) return { code: 0 }
  return runList(parsed.items, ctx, 0, { left: MAX_SEGMENTS, depthReported: false, limitReported: false })
}
```

`ctx.reexec` 是 `sudo` / `ssh` 的实现基础：它们不是「新开一个 shell」，而是「用另一个 uid 在当前上下文里再跑一行」。

### 4.2 语法：够用就停

支持引号、管道、`; && ||`、`> >> < 2> 2>> &> 2>&1`、glob、`$VAR`、`$1..$9`、别名、单行函数、Tab 补全、历史。**明确拒绝**三样：

```39:39:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/parser.ts
 * Background jobs, command substitution, and subshells are disabled.
```

```88:88:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/parser.ts
      if (this.peek() === '&' && this.source[this.i + 1] !== '>') throw new Error('background jobs are disabled')
```

理由很实在：这三样都要求「再开一个执行上下文」，在没有进程模型的世界里成本远大于收益。

### 4.3 输出协议：终端只认识字段

core 与 UI 之间只有一个结构体：

```54:67:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/context.ts
/** Everything one command line returns. The view decides how to present each field. */
export interface CommandResult {
  code: number
  stdout?: string
  stderr?: string
  /** stdout is a page to read; a host may set it in a proportional face. */
  prose?: boolean
  clear?: boolean
  logout?: boolean
  exitPane?: boolean
  pager?: string
  downloads?: Download[]
  stage?: Stage
}
```

| 字段 | 对应 Linux |
| --- | --- |
| `code` | exit status |
| `stdout` / `stderr` | fd 1 / fd 2（但是字符串，不是流） |
| `logout` / `exitPane` | `SIGHUP` / 退出 |
| `pager` | `less` |
| `stage` | 「打开一个窗口」（vim / md / pdf） |
| `downloads` | 浏览器下载 |
| `prose` | 排版提示，无 Linux 对应 |

### 4.4 `/etc/profile`：一条新命令都不用加

profile 就是普通命令行，所以只需要一个「逐行执行」的循环：

```14:33:D:/LEARNING_RESOURCE/HomePage/packages/core/src/app/profile.ts
export async function runProfile(ctx: ShellCtx): Promise<string> {
  let output = ''
  for (const path of ['/etc/profile', `${homeDir(ctx.user)}/.profile`]) {
    let text: string
    try {
      const node = ctx.rt.fs.read(ctx.user, path)
      if (node.encoding !== 'utf8') continue
      text = node.content
    } catch {
      continue
    }
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const result = await runLine(line, ctx)
      if (result.stdout) output += result.stdout
      if (result.stderr) output += result.stderr
    }
  }
  return output
}
```

因为 `export`、`alias`、函数定义、`umask` 都已存在，`content/etc/profile` 可以是真文件：

```text
umask 022
export EDITOR=vim
export PAGER=less
alias grep='grep -n'
alias df='df -h'
sysinfo() { uname -a; echo; id; echo; mount; }
```

实测 `sysinfo` 输出：

```text
Linux Yujiang Adam Li's Homepage 6.1-home #1 SMP Home

uid=0(root) gid=0(root) groups=0(root)

content on / type overlay (rw,lowerdir=/image,upperdir=local)
proc on /proc type proc (ro,nosuid,nodev,noexec)
tmpfs on /tmp type tmpfs (rw,nosuid,nodev,size=64m)
```

`umask` 是新的，它让 `createdMode` 不再硬编码：

```37:44:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/policy.ts
/**
 * Mode of a new file or directory, from the requested bits and the umask.
 * The default umask is 022, so a directory is 0755 and a file 0644.
 */
export function createdMode(kind: 'file' | 'dir', umask = 0o022): number {
  const wanted = kind === 'dir' ? 0o777 : 0o666
  return wanted & ~umask & 0o777
}
```

### 4.5 显示层与数据层：链接是「屏幕上的东西」
`ls` 输出的每个名字都带一个 OSC 8 超链接，目标是**一条命令**：

```71:77:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/commands/helpers.ts
/**
 * Wrap text in an OSC 8 hyperlink. Nothing is drawn; the target rides along.
 * A `cmd:` target is typed at the prompt when the reader clicks it.
 */
export function link(text: string, command: string): string {
  return `\x1b]8;;cmd:${encodeURIComponent(command)}\x1b\\${text}\x1b]8;;\x1b\\`
}
```

而管道、重定向、读文件时必须剥掉它，否则 `grep` 会看到转义序列：

```19:22:D:/LEARNING_RESOURCE/HomePage/packages/core/src/kernel/text.ts
/** Drop links and motion, keep color. Used for pipes, redirects and file text. */
export function stripLinks(text: string): string {
  return text.replace(OSC_ALL, '')
}
```

这正是真实终端的语义：**转义序列只对 tty 有意义，写进文件就是垃圾字节**。

### 4.6 窗格：一棵布局树

`Mux` 是纯数据，画出什么都不归它管。会话、窗口、布局三层，和 tmux 同构；布局是二叉树，`row` 左右、`col` 上下，每个分支带一个 `ratio`：

```26:30:D:/LEARNING_RESOURCE/HomePage/packages/core/src/mux/mux.ts
export type Layout =
  | { t: 'pane'; id: string }
  | { t: 'row'; a: Layout; b: Layout; ratio: number }
  | { t: 'col'; a: Layout; b: Layout; ratio: number }
```

`ratio` 只影响渲染：浏览器把它翻成 `flex-grow`，于是窗格按比例分享同一个窗口，缩放浏览器时也不会失衡。

`Ctrl-b` 之后 `%` / `"` 分屏，`hjkl` 移动，`Alt+方向` 调整分隔线，`x` 关窗格，`c` / `&` 开关窗口。命令行侧是同一套动作，且是唯一被测试覆盖的那一侧：

```text
tmux list-windows       0: notes* (2 panes)
tmux list-panes         p1* 40 cols / p3
tmux resize-pane -L 10  把分隔线移动 10 列
tmux rename-window      给当前窗口一个名字
tmux select-window -t 1 按序号切换
```

CLI 里 `rt.mux` 是 `null`，于是 `tmux` 诚实地说 `not available`——多路复用是宿主能力，不是内核能力。

---

## 5. 前端渲染分离

### 5.1 三个端口

`core` 从不直接调用平台 API，它只声明三个接口：

```16:29:D:/LEARNING_RESOURCE/HomePage/packages/core/src/app/runtime.ts
export interface Runtime {
  site: SiteConfig
  fs: VirtualFS
  mail: Mailer
  outbox: Outbox
  persist: () => Promise<void>
  procs: () => Proc[]
  mux: SessionHost | null
}
```

```19:40:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/context.ts
/** What a command may ask the terminal for. The UI answers; the shell never draws. */
export interface Host {
  /** null means Ctrl-C. Ctrl-D resolves with the text entered so far, which may be empty. */
  readStdin(): Promise<string | null>
  askSecret(prompt: string): Promise<string | null>
  /** null means the chooser was dismissed. */
  pickFiles(options?: PickOptions): Promise<PickedFile[] | null>
  /** Restyling is a page capability. A real terminal leaves this out. */
  style?: HostStyle
}
```

可选能力用 `?` 标记。`style` 就是例子：浏览器有它，CLI 没有，所以同一个命令在真终端里会**诚实地报错**而不是静默失败：

```237:240:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/commands/site.ts
    run(ctx, args) {
      const host = ctx.host.style
      if (!host) return { code: 1, stderr: 'style: this terminal cannot restyle itself\n' }
```

### 5.2 命令不画像素

`vim` / `md` / `pdf` 只返回一个 `stage` 描述，由 UI 决定怎么呈现：

```52:55:D:/LEARNING_RESOURCE/HomePage/packages/core/src/shell/context.ts
export type Stage =
  | { kind: 'vim'; path: string | null; filename: string; text: string }
  | { kind: 'md'; title: string; text: string; base: string }
  | { kind: 'pdf'; title: string; url: string }
```

于是 `packages/web/src/ui/present.ts` 可以给 `md` 挂 Markdown 渲染、给 `pdf` 挂 `<iframe>`，而 core 完全不知道这两件事。`vim` 的引擎也在 web 侧（`ui/vim/engine.ts`），但它保存文件时仍然走 core：

```252:263:D:/LEARNING_RESOURCE/HomePage/packages/web/src/ui/present.ts
async function saveBuffer(ctx: ShellCtx, path: string, text: string): Promise<{ error: string | null; notice: string }> {
  ctx.rt.fs.begin()
  try {
    writeFile(ctx.rt.fs, path, text, false)
    const note = await seal(ctx)
    return { error: null, notice: note.trim() }
  } catch (err) {
    if (ctx.rt.fs.inTx()) ctx.rt.fs.abort()
    return { error: err instanceof Error ? err.message : String(err), notice: '' }
  }
}
```

**「怎么编辑」是 UI 的自由，「写不写得到」是内核的规则。**

### 5.3 主循环

```17:40:D:/LEARNING_RESOURCE/HomePage/packages/web/src/ui/loop.ts
export async function shellLoop(
  view: TermView,
  ctx: ShellCtx,
  opts: { intro?: string; onPrompt?: () => void; onCommand?: (line: string, code: number) => void },
): Promise<'logout' | 'exit' | 'closed'> {
  ctx.host = view
  view.onTab = (line) => {
    const result = completeLine(line, ctx)
    view.setInput(result.line)
    if (result.matches.length > 1 && result.line === line) {
      view.print(`${result.matches.slice(0, 80).join('  ')}\n`, 'dim')
    }
  }
  if (opts.intro) await view.print(opts.intro, 'out', { maxMs: INTRO_MS_MAX })
  // /etc/profile, then ~/.profile. A login shell does this once, before the
  // first prompt, and so does this one.
  const profile = await runProfile(ctx)
  if (profile) await view.print(profile)
```

`ctx.host = view` 这一行就是全部接线：`TermView` 实现 `Host`，于是 `cat` 的 `readStdin`、`passwd` 的 `askSecret`、`scp` 的 `pickFiles` 都指向同一个 textarea。

### 5.4 终端设备

| tty 的职责 | `TermView` 的实现 |
| --- | --- |
| 行编辑、光标 | 隐藏 `<textarea>`（中文输入法候选框能跟随光标） |
| `Ctrl-C` → `SIGINT` | 事件 → `{ type: 'interrupt' }` |
| `Ctrl-D` → EOF | 事件 → `{ type: 'eof' }` |
| Tab 补全 | `onTab` → `completeLine` |
| 分页 | `.pager` DOM + `space/b/j/k/g/G/q` |
| `TERM=xterm-256color` | 真解析 SGR 颜色、OSC 8 链接、OSC 5522 动画 |

### 5.5 主题：只换 CSS，不换代码

主题文件由 glob 收集，因此「列在名单里但没打包」不可能发生（这个 bug 曾经真的发生过）：

```14:18:D:/LEARNING_RESOURCE/HomePage/packages/web/src/main.ts
import './ui/app.css'
// Every theme file in the folder ships. Adding a name to THEMES and a file beside
// this one is the whole change: the glob cannot fall out of step with the list,
// which an explicit import can (terminator.css was once listed but never bundled).
import.meta.glob('./ui/themes/*.css', { eager: true })
```

---

## 6. 与 Linux 原生的异同

### 6.1 已经对齐的

| 机制 | Linux | 这里 |
| --- | --- | --- |
| 分层存储 | overlayfs（lower / upper / whiteout） | `image` / `local` / `tomb` |
| 删除的可逆性 | 删 whiteout 即恢复 | `restore` 命令 |
| DAC 三类位 | owner/group/other | ✅ |
| 补充组 | 进程有一组 gid | `user.groups` 名字数组 |
| 父目录 `x` | 路径可达性 | `assertSearch` |
| sticky | 只限制删除 | `assertUnlink` |
| setuid | exec 时换 euid | `execIdentity` |
| 写文件清 setuid | ✅ | ✅（除非 `CAP_FSETID`） |
| capabilities | ✅ | ✅ 八个 |
| 账户 | `/etc/passwd` `/etc/group` `/etc/shadow` | ✅ 真解析 |
| 登录 shell | 读 `/etc/profile`、`~/.profile` | `runProfile` |
| `umask` | ✅ | ✅ |
| `/proc` | 合成文件系统 | ✅ |
| 挂载表 | `/proc/mounts` | ✅ |
| 退出状态 | ✅ | `CommandResult.code` |
| 管道/重定向 | ✅ | ✅（字符串而非流） |
| ANSI | ✅ | SGR / OSC 8 / OSC 5522 |

### 6.2 有意不同的

| 项 | Linux | 这里 | 为什么 |
| --- | --- | --- | --- |
| 进程 | `fork` + `execve` | 一次函数调用 | 浏览器里没有进程 |
| 信号 | `SIGINT` 打断阻塞调用 | UI 事件，打断不了 `await` | 同上 |
| 后台任务 | ✅ | 拒绝 | 没有调度器 |
| 命令替换 | ✅ | 拒绝 | 需要子上下文 |
| 事务 | 无 | 每条命令一个 | 屏幕上不该出现半成品 |
| 未知用户登录 | 拒绝 | 建一个会话级账户 | 站点需要「谁都能进」 |
| `/etc/perm` | 无 | 构建期元数据表 | 静态产物只存字节 |

### 6.3 完全缺失的

硬链接、符号链接、设备节点、FIFO、`mmap`、`atime`/`ctime`、xattr、ACL、`O_APPEND` 原子性、文件锁、quota、`tar`/`gzip`、`awk`/`sed`、job control、`/proc` 里的真实进程条目。

---

## 7. 已知边界

1. **权限不是访问控制。** `/fs/etc/shadow` 是静态资源，`fetch` 直接取走。终端里的 DAC 是真的，HTTP 层永远是 0755。
2. **`/etc/shadow` 的哈希可被直接下载**，强度只到「看起来真」。
3. **影子文件是单个文件**，被标成会话级，所以同一会话里 root 改密码也不会持久化。
4. **两个标签页是两台机器**，共享一份「最后写入者获胜」的快照。
5. **`/proc` 只有本进程**。`ps` 仍然读 `mnt` 的 pane 列表，而不是遍历 `/proc/<pid>`。
6. **setgid 只清除、不生效**；`CAP_SETGID` 目前没有消费点。

---

## 附：文件地图

```text
content/                      硬盘：页面 + 账户 + 挂载点
  etc/passwd group shadow     账户
  etc/perm                    构建期元数据例外
  etc/caps                    非 root 的 capability
  etc/profile                 登录脚本
  bin/passwd                  4755，唯一能写 shadow 的文件
packages/core/                内核 + shell，无 DOM
  kernel/vfs.ts               三种路径 + 事务
  kernel/policy.ts            DAC + mode 解析
  kernel/caps.ts              capabilities
  kernel/perm.ts              构建期元数据
  kernel/proc.ts              /proc 合成层
  kernel/accounts.ts          账户、哈希、登录
  shell/runner.ts             一行命令 = 一个事务
  shell/commands/*.ts         50 个命令
  app/profile.ts              登录脚本
  app/system.ts               挂载 /proc / tmpfs
packages/web/                 浏览器：终端、主题、IndexedDB
packages/cli/                 同一套 core，真终端
vite/content.ts               content/ → manifest（含元数据）
```
