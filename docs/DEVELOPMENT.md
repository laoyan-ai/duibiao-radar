# 开发与二次编程

## 环境与命令

Windows 10/11、Node.js>=22、Chrome。克隆独立仓库，使用自己的配置与账号。

~~~powershell
git clone https://github.com/laoyan-ai/duibiao-radar.git
cd duibiao-radar
npm ci
npm run check
npm run build
npm start
~~~

开发运行 npm run dev；测试 npm test。浏览器测试用 Chrome channel，需已安装 Chrome；加密测试依赖 Windows，部分权限测试在不具备 symlink 权限时跳过。测试使用临时目录、模拟网页和假凭据，不需要真实 API 或抖音登录。视觉测试会生成被忽略的可行性验证目录。

## 目录

| 目录 | 作用 |
| --- | --- |
| public | HTML/CSS/JS、Logo及标签页图标 |
| src/server.ts | 本机HTTP入口、API、会话校验 |
| src/browser.ts、search-authors.ts | 浏览器采集、主页身份核实 |
| src/jobs.ts、store.ts | 任务流程、断点、持久化 |
| src/collection-scope.ts | N/M参数及旧任务默认值 |
| src/scoring.ts、analyzer.ts | 点赞与语义评分、结构化输出校验 |
| src/providers.ts、provider-transport.ts | 厂商配置、直连请求和地址约束 |
| src/credentials.ts | Windows当前用户DPAPI加密 |
| test | 离线单元、API、浏览器回归及合成网页 |
| scripts/start-local.mjs | 检查服务版本并启动，避免重复实例 |

服务绑定127.0.0.1，默认端口3210。任务、证据在data，Key密文与浏览器档案在.local。不得将服务改为公网监听后直接部署；当前没有面向多用户的权限体系。

## 用 Codex / Cursor / VS Code 打开

打开仓库根目录，先读README、本文和PRIVACY，再安装依赖。可以使用提示词：“请先解释当前采集和评分流程，再在保留缺失数据标记及本机密钥保护的前提下，为……增加功能，并运行相关测试。”

不要把真实Key写进提示词、源码或测试。修改后运行check、相关测试、build；新增后台逻辑时同步src/build.ts与public/app.js版本及相应测试，正常重启后验证health，避免页面与旧后台混用。静态资源更新时也检查favicon和缓存版本。

## 发布

对干净源码执行check/build/test，再在空数据目录做启动验证。源码包来自受控文件清单；Windows启动包增加dist与启动对标雷达.cmd，安装运行依赖后直接启动。两个包均不带node_modules、Chrome、Node、data、.local、环境变量或旧Git历史。保留第三方许可，发布前检查ZIP清单与SHA256。

此仓库首版来自经过清理的独立快照，原私有开发历史不在仓库。模型/网页随时间变化，需回归真实环境；离线测试通过不代表平台永不变化。
