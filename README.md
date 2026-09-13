# LeuBai V2

留白 / Adaptive To-do。本地优先的意图、时间台账、方案审批、工作稿与留白空间，包含 18 个设计页面、瓷白与水墨主题，以及本地 LLM 设置服务。

## 本地运行

使用 Node.js 22.22.2 或兼容版本：

```sh
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:5200`。该入口同时提供构建页面与本地 API。开发时分别运行 `npm run server` 和 `npm run dev`，Vite 默认将 `/api` 转发至本机 5200。

端口可用 `LEUBAI_PORT` 调整，开发代理可用 `LEUBAI_API_URL` 指定。业务记录保存在浏览器当前 origin 的本地存储中；更换协议、主机或端口会进入另一份存储，不表示旧数据被删除。

## 设置与边界

在设置页粘贴 LLM 端点文本，核对解析字段，测试后明确保存。API Key 不写入前端包，也不回显已保存值；本地服务默认存放于 `.leubai-local/llm-settings.json`。不要提交该目录或将密钥写入证据文档。

瓷白是默认主题，水墨可在设置页切换。方案预览不等于生效；批准、实际写入与读回结果分开呈现。未确认结果保留原请求供核对，不显示虚假成功。

当前服务只允许 loopback 绑定，不是公开多用户服务。真实日历、音乐账户、麦克风与系统分享需要各自权限及实际设备验收；未连接来源显示明确边界。音乐适配器的未知请求恢复目前限于同一运行时、同一适配器实例。

## 验证

```sh
npm run test:unit
npm run lint
npm run build
```

`test:unit` 仅执行本地纯测试与本地服务测试，不启动浏览器。交互、截图和视觉验收只使用 Codex 内置浏览器或 Ego Lite。保留的 `test:e2e` 不属于当前获准的浏览器验证路径。

## 交付资料

- [产品需求](docs/PRD.md)
- [逐项交付矩阵](docs/DELIVERY-MATRIX.md)
- [发布状态与证据](docs/RELEASE-STATUS.md)
- [设计系统](DESIGN.md)
- [设置与水墨补充需求](docs/SETTINGS-AND-INK-ADDENDUM.md)

测试通过、截图存在、本地启动和公开上线是不同验收层级；以发布状态中的实际证据与未决项为准。
