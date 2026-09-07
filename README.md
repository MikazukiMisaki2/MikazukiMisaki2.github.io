# Sephie's Lab

Sephie's Lab 的公开对局分析页面，部署在 GitHub Pages：

<https://mikazukimisaki2.github.io/>

页面是纯静态 HTML/CSS/JavaScript，通过 Cloudflare Worker 读取经过汇总的分析数据。原始对局继续保存在私有 R2 桶中，上传密钥不会放进这个仓库。

`worker/` 保存 Worker 的可复现源码和 R2 绑定配置；密钥 `UPLOAD_TOKEN` 只在 Cloudflare Worker Secret 中维护。
