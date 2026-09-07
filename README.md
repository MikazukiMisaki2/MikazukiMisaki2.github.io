# Sephie's Lab

Sephie's Lab 的公开对局分析页面，部署在 GitHub Pages：

<https://mikazukimisaki2.github.io/>

页面是纯静态 HTML/CSS/JavaScript，通过 Cloudflare Worker 读取经过汇总的分析数据。原始对局继续保存在私有 R2 桶中，上传密钥不会放进这个仓库。

`worker/` 保存 Worker 的可复现源码和 R2 绑定配置；密钥 `UPLOAD_TOKEN` 只在 Cloudflare Worker Secret 中维护。

`card-names.json` 是从 Tracker 使用的 `SV_WB_Cards.csv` 生成的公开卡牌名称索引，用于把分析结果中的卡牌 ID 显示为中文卡名。
