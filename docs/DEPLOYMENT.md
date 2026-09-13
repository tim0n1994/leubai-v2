# LeuBai 本地部署与 Cloudflare Tunnel

部署地址为 `https://leubai.udify.fun`，应用仍运行在这台 Mac 的 loopback 地址。公网 DNS 只指向专用 Cloudflare Tunnel，不公开本机端口。认证、登录会话和按用户隔离的业务数据必须先完成验收，再启动公网 connector。

## 已建立的资源

| 项目 | 值 |
| --- | --- |
| Tunnel 名称 | `leubai-v2` |
| Tunnel UUID | `9a9696a6-d825-4c79-8163-72f5fff4fd66` |
| 公网域名 | `leubai.udify.fun` |
| Origin | `http://127.0.0.1:5220` |
| 配置 | `deploy/cloudflared.yml` |
| 凭据 | `/Users/chillbit/.cloudflared/9a9696a6-d825-4c79-8163-72f5fff4fd66.json`，不在仓库内 |
| Metrics | `http://127.0.0.1:20246/metrics` |

当前机器还有承载其他项目的共享隧道。此部署使用独立 UUID、配置、端口和进程；不修改或重启 `/Users/chillbit/.cloudflared/config.yml` 对应的共享服务。

## 启动流程

在 `/Users/chillbit/Proj/leubai-v2` 中构建，并按认证模块的部署配置启动正式入口于 5220。当前默认入口命令为：

```sh
npm run build
LEUBAI_PORT=5220 npm start
```

启动公网 connector 前，确认新认证模块已生效，未登录请求不能读取个人业务数据或操作 LLM 管理设置。仅有页面 HTTP 200 不构成此项验收。`5220` 为新部署专用端口，不能直接将已有本地管理服务 `5200` 暴露到公网。

配置校验和路由匹配均为只读：

```sh
cloudflared tunnel --config deploy/cloudflared.yml ingress validate
cloudflared tunnel --config deploy/cloudflared.yml ingress rule https://leubai.udify.fun/
```

自 2026-09-13 起应用与 connector 均由 launchd 专用服务托管（`com.udify.leubai-app`、`com.udify.leubai-connector`，plist 位于 `~/Library/LaunchAgents/`，KeepAlive + RunAtLoad）。日常启停入口为桌面 `留白启动.command`（自动 bootstrap/kickstart、dist 新鲜度检查、公网探测失败时自动重启 connector 最多 3 轮）。调试时可手动前台运行：

```sh
cloudflared tunnel --config deploy/cloudflared.yml --no-autoupdate run
```

手动前台运行前先 `launchctl bootout gui/$(id -u)/com.udify.leubai-connector`，避免两个 connector 同时争用 metrics 端口 20246。按 `Ctrl-C` 只停止此前台实例；launchd 服务可独立 `kickstart`。不要使用无专用配置的 `cloudflared service install`，以免接管其他项目的共享服务。

## 验收与运维

```sh
curl --fail --silent --show-error http://127.0.0.1:5220/ -o /dev/null
cloudflared tunnel info 9a9696a6-d825-4c79-8163-72f5fff4fd66
curl --fail --silent --show-error https://leubai.udify.fun/ -o /dev/null
```

浏览器验证仅使用 Codex 内置浏览器或 Ego Lite，覆盖：未登录入口、登录/退出、两位用户数据隔离、非法会话、跨站写请求、管理员设置、深链接刷新和实际应用操作。公网域名是新的 browser origin，旧 `127.0.0.1` 本地记录不会自动出现在此域名下，不能在未确认归属时自动导入到任意新账户。

本机睡眠、应用退出、断网或 connector 停止都会影响公网可用性。LLM 私密设置与用户数据目录按认证模块最终存储契约备份；隧道凭据及邮箱服务密钥不得写入前端构建、仓库、截图或运行日志。使用 info 日志；不要为常规部署打开会记录请求头的 debug 日志。

需要撤回公网访问时，停止专用 connector 即可；保留 DNS 与凭据便于恢复，不删除任何用户数据。重新开始服务前先校验本地应用和会话安全。

配置与命令依据 [Cloudflare 本地管理隧道文档](https://developers.cloudflare.com/tunnel/advanced/local-management/create-local-tunnel/) 与 [Ingress 配置文档](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/)。

## 当前部署状态（2026-09-13）

- 公网应用已上线：应用实例 `:5220`（`LEUBAI_PUBLIC_ORIGIN=https://leubai.udify.fun`、`LEUBAI_TRUST_CLOUDFLARE=1`、`EMAIL_TRANSPORT=resend`，密钥从 `.leubai-local/env` 的 `LEUBAI_SENDER_*` 前缀变量在服务启动时映射），cloudflared connector 使用隧道 `9a9696a6-d825-4c79-8163-72f5fff4fd66`，DNS 已解析，公网 root/login 实测 200。验收环境变量位于 `.leubai-local/env`（不入库）。
- 本机验收另有 loopback 实例 `:5201`（`EMAIL_TRANSPORT=console`），仅用于本地开发验证码流程。
- 公开注册按 `EMAIL_TRANSPORT=resend` 真实发信（发送专用 Resend key，`LEUBAI_SENDER_*` 前缀隔离）。实际收件仍以用户确认邮箱为准。
- 应用与 connector 已由 launchd 持久化托管（`com.udify.leubai-app`、`com.udify.leubai-connector`，KeepAlive + RunAtLoad，随登录自启），进程崩溃自动拉起；桌面 `留白启动.command` 负责开机后一键拉起与验证。本机睡眠或断网仍会中断公网可用性。撤回公网访问：`launchctl bootout gui/$(id -u)/com.udify.leubai-connector`。
