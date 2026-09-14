# LucaRice 多用户扩展约定

账户服务是唯一的身份与会话归属来源：`ctx.accounts`。

## 数据位置

每个用户的可写业务数据均放在：

```text
.lucarice-data/users/<用户 UUID>/<功能目录>/
```

例如田块资料为 `fields/`，表格导出为 `exports/`，模型凭据为 `credentials.yaml`。用户名只用于显示，不用于目录名；改用户名不会影响已有数据。

知识包、嵌入模型和品种审定库是所有用户共享的只读资源，不应复制到用户目录。

## 新增 Node 工具或 HTTP 接口

1. 在插件 `inject` 中加入 `accounts`。
2. HTTP 请求先执行 `ctx.accounts.userForRequest(request)`；没有用户时返回 401。
3. 需要写文件时用 `ctx.accounts.userDataDir(user.id, '你的功能目录')` 取得目录。

## 新增 Python 工具

Node 代理根据当前会话取得用户：

```ts
const userId = ctx.accounts.ownerForSession(exec.agent.session.id)
```

再把该 ID 仅作为 `x-lucarice-user-id` 请求头发给本机 Python 服务。Python 服务以 `--data-root` 和该请求头定位：

```text
<data-root>/users/<用户 UUID>/<功能目录>/
```

不要让模型传入用户 ID、文件系统路径或其他账户标识。工具只接收自身业务参数。

## 会话规则

新会话创建时由 API 层自动归属到当前账户。任何读取、发送消息、附件、下载、工具调用和实时事件都会按该归属过滤。新功能如果以会话为入口，应复用 `ownerForSession`，不要自行建立第二套用户映射。

## 管理原则

管理员创建普通账户；每个用户只能看到自己的会话、附件、田块、导出文件和模型凭据。新增功能只要遵守以上两种接入方式，就不会与现有用户数据混用。
