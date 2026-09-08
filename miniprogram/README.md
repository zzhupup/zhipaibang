# 无声劫案 · 微信小程序版

一款 3~6 人合作扑克行动小程序：各自手机在线联机，或同屏热座。玩法机制参考了实体桌游的"暗号式合作"设计，**名称、规则文案、界面均为原创**，不包含任何第三方桌游的商标、美术或原文。

- **在线联机**：各自手机，输入 6 位房间号加入同一局（微信云开发实时数据推送，无需自建服务器）
- **同屏热座**：一部手机轮流操作（纯本地，零依赖）

## 玩法（两种模式规则一致）

- **3~6 人**合作，圆桌布局
- 每次劫案 4 轮（翻牌前/翻牌/转牌/河牌），白→黄→橙→红筹码传递"自认牌型排名"信号
- 全员确认机制：拿定筹码后各自点"确认"，确认前可自由换筹码，变动后重新确认
- 摊牌按红星星数升序，牌型"不弱于"上一位（打平可），金库 3 金胜 / 警报 3 红败
- 进阶模式：10 张挑战牌 + 10 张专家牌全量实现

## 项目结构

```
├── app.js / app.json / app.wxss / sitemap.json / project.config.json
├── utils/
│   ├── poker.js        # 牌与牌型引擎（A低顺/骑士J/5同点按四条计）
│   ├── game.js         # 流程引擎（UI 适配器注入：render/modal/pickHoleCard）
│   ├── cloudRoom.js    # 云开发房间通道（创建/加入/watch/操作馈送）
│   └── onlineHost.js   # 联机房主端 UI 适配器（引擎弹窗路由到对应玩家手机）
└── pages/
    ├── home/           # 开局：联机/热座选择、模式、人数、名字、规则
    ├── room/           # 联机房间：6 位房间号、玩家列表、开局
    └── table/          # 圆桌牌桌：单机/房主/客人三种渲染模式
```

## 联机架构（房主权威模式）

- 房主手机运行完整游戏引擎；其余手机为"视图 + 操作发送端"
- 公开状态（公共牌/筹码/确认进度/全员弹窗）写入 `rooms` 文档，所有人 `watch` 实时刷新
- **底牌隐私**：每人底牌写入 `hands/{roomId}_{seat}` 文档，安全规则限定只有本人可读；房主可写（发牌/换牌）
- 所有操作写入 `actions` 馈送，房主按序消费——并发抢筹码天然按先后顺序裁决

## 运行 / 部署

1. 微信开发者工具导入项目，替换 `project.config.json` 的 `appid`
2. **联机需开通云开发**（开发者工具 → 云开发 → 创建环境，基础版约 19.9 元/月），把环境 ID 填入 `utils/cloudRoom.js` 的 `ENV_ID`
3. 云开发控制台创建 4 个集合并配置安全规则：

```json
// rooms：房主写，任何人可读（凭房间号）
{ "read": true, "write": "resource.hostOpenid == auth.openid" }

// players：本人写自己的文档，房间成员可读
{ "read": true, "write": "auth.openid == resource._openid" }

// hands：底牌机密！只有本人可读自己的，只有房主可写
{ "read": "auth.openid == resource.owner", "write": "get(`database.rooms.${resource.roomId}`).hostOpenid == auth.openid" }

// actions：操作馈送
{ "read": "get(`database.rooms.${resource.roomId}`).hostOpenid == auth.openid || auth.openid == resource.from", "write": true }
```

4. 编译后即可：创建房间 → 分享房间号/卡片 → 好友加入 → 开始对局

## 测试

```bash
node test_mp_poker.js      # 牌型引擎 12 项（与网页版一致）
node test_online_flow.js   # 联机流程端到端模拟（含底牌隐私校验）
```

## 快速上线清单

1. 注册小程序（个人主体即可），类目建议工具类目（"桌游规则辅助工具"性质，无支付无 UGC）；"小游戏"类目需要游戏版号
2. 隐私：不收集用户信息（openid 仅用于房间路由与底牌权限），隐私保护指引如实勾选
3. 提审备注："桌游辅助工具，无网络请求白名单（使用云开发内置通道），无支付、无 UGC"
