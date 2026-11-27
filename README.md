# home

一个用终端读的个人主页。登录后 `ls`、`cat`、`grep`、`find` 打开页面，`wget` 下载文件，`vim` 编辑访客留言。构建产物是一个静态站，可以放在 GitHub Pages 上。

```bash
npm install
npm test        # 211 个用例
npm run dev     # http://localhost:5173
npm run cli -- ls /home/owner   # 同一套内核，在真终端里
```

任意用户名和任意密码都能登录。`root` 是唯一保留密码的账户，密码哈希在 `content/etc/shadow`。

---

## 设计思路

三句话：

**`content/` 是硬盘，`packages/core` 是内核，`packages/web` 是显示器。** 命令行不画像素，只返回一个结构体；终端不解析业务，只负责呈现。

**文件系统有三种路径。** `image` 是构建产物（只读、共享），`local` 是这台浏览器写的（可写、刷新后仍在），`/proc` 是读取时才生成的（不占一个字节）。删除用墓碑，`restore` 撤销墓碑——这就是 overlayfs。

**权限是 DAC，不是角色。** 每个文件有 owner / group / mode，父目录要 `x`，sticky 只限制删除，`setuid` 在 exec 时换 euid。root 不是特例：它是「持有全部 capability 的账户」，非 root 账户可以从 `/etc/caps` 拿到某一个。

由此带来的两条硬规则：

- `packages/core` 不 import `packages/web`，也不碰 `window` / `document` / `indexedDB`。平台能力全靠 `Runtime`、`Host`、`Store` 三个端口注入。
- 权限在终端里是真的，但**不是访问控制**：`/fs/etc/shadow` 是静态文件，`fetch` 直接取走。这是这个项目的诚实之处，也是彩蛋的入口。

---

## 使用方式

### 浏览

```sh
index                 # 首页地图，每行都是可点的路径
ls -l /home/owner     # -n 关掉图标，-a 显示隐藏文件
tree -p -L 2          # -p 显示权限位
cat about.txt         # .md/.txt 会按页面排版
md about.md           # 在浏览器里渲染 Markdown
pdf me.pdf            # 在浏览器里打开 PDF
```

### 账户与权限

```sh
id                    # uid、gid、所有组
capsh                 # 当前持有哪些 capability
sudo -u root id       # wheel 成员可用，要求本人密码
passwd                # 改自己的密码（/bin/passwd 是 4755）
su owner              # 切到另一个账户
```

### 系统

```sh
mount                 # 读 /proc/mounts
df -h                 # 按挂载点统计
free                  # 读 /proc/meminfo
cat /proc/self/status # 这个 pane 的 uid、组、主机名
uname -a
```

### 留言板

```sh
cd /var/guestbook
vim your-name.txt     # 写一条
scp                   # 从本机上传文件
mail --user you@example.com
mail -m "subject"
mail add .
mail push             # 只 POST 到 site.webhookUrl
```

### 窗格

`Ctrl-b` 之后：`%` 左右分屏，`"` 上下分屏，方向键或 `hjkl` 移动，`x` 关闭，`c` 新窗口，`n`/`p` 切换。

### 彩蛋

`content/var/guestbook/message.json` 里有一条留言，说某个私钥被 HTTP 服务暴露了。`ss` 和 `curl` 可以验证这句话，剩下的路自己走。

---

## 目录

```text
content/             访客能 cat 的页面，也是唯一发布的目录
  etc/               账户、权限例外、登录脚本
  home/              每个账户的 home
  var/guestbook/     留言板
packages/core/       内核、shell、账户、/proc：不含 DOM
packages/web/        浏览器终端、主题、IndexedDB
packages/cli/        同一套 core，跑在真终端
vite/content.ts      content/ → manifest（含 mode/uid/gid）
docs/design.md       设计报告：三个系统与渲染分离
```

加一个命令：在 `packages/core/src/shell/commands/` 里追加一项，`help`、`man`、Tab 补全都会自动读到它。

---

## 限制

没有进程和信号，所以 `Ctrl-C` 打断不了正在 `await` 的调用；没有后台任务与命令替换；没有符号链接、`tar`、`awk`。两个标签页是两台独立的机器，共享一份「最后写入者获胜」的快照。
