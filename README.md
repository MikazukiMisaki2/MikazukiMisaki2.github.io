# Sephie's Lab

Sephie's Lab 的公开对局分析页面，部署在 GitHub Pages：

<https://mikazukimisaki2.github.io/>

页面是纯静态 HTML/CSS/JavaScript，通过 Cloudflare Worker 读取经过汇总的分析数据。原始对局继续保存在私有 R2 桶中，上传密钥不会放进这个仓库。

`worker/` 保存 Worker 的可复现源码和 R2 绑定配置；密钥 `UPLOAD_TOKEN` 只在 Cloudflare Worker Secret 中维护。

`card-names.json` 是从 Tracker 使用的 `SV_WB_Cards.csv` 生成的公开卡牌名称索引，用于把分析结果中的卡牌 ID 显示为中文卡名。

页面首先展示 Best Decks / Meta Tier List、tracker 风格的职业与卡组使用率饼图、职业胜率柱状图；选择职业、卡组类型或具体构筑后，才会显示对应范围的局数、胜负、结束回合和先后手表现。Trending Cards / Meta-Shifting 与卡牌对照表放在同一块卡牌情报区域。

上传记录中的我方卡组类型会自动合并不同构筑，矩阵按卡组类型统计对抗关系；未识别的对手卡组不会进入卡组矩阵，同种卡组的对角线用 `-` 表示。选择卡组后可以查看公开的卡牌 ID、数量、卡名以及该具体构筑对各对手卡组/职业的胜率。对手没有完整牌表时仍只公开识别出的卡组类型或职业，不会伪造对手牌组构成。
