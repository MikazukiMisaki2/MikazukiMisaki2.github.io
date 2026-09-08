# Sephie's Lab

Sephie's Lab 的公开对局分析页面，部署在 GitHub Pages：

<https://mikazukimisaki2.github.io/>

页面是纯静态 HTML/CSS/JavaScript，通过 Cloudflare Worker 读取经过汇总的分析数据。原始对局继续保存在私有 R2 桶中，上传密钥不会放进这个仓库。

`worker/` 保存 Worker 的可复现源码和 R2 绑定配置；密钥 `UPLOAD_TOKEN` 只在 Cloudflare Worker Secret 中维护。

`card-names.json` 是从 Tracker 使用的 `SV_WB_Cards.csv` 生成的公开卡牌名称索引，用于把分析数据中的卡牌 ID 转为中文卡名；网页端只显示卡名，不显示 ID。

页面首先展示 Best Decks / Meta Tier List、tracker 风格的职业与卡组使用率饼图、职业胜率和卡组胜率柱状图；使用率与胜率会把已识别的对手一侧按相反结果纳入统计。选择职业、卡组类型或具体构筑后，才会显示对应范围的局数、胜负、结束回合和先后手表现。Trending Cards / Meta-Shifting 与卡牌对照表放在同一块卡牌情报区域。

上传记录中的我方卡组类型会自动合并不同构筑，矩阵按卡组类型统计对抗关系；未识别的对手卡组不会进入卡组矩阵，同种卡组的对角线用 `-` 表示。选择卡组后可以查看公开的卡牌数量、卡名以及该具体构筑对各对手卡组/职业的胜率。对手没有完整牌表时仍只公开识别出的卡组类型或职业，不会伪造对手牌组构成。

## 维护说明

- `index.html`：修改页面中的固定文字、标题、表头和区块顺序。
- `app.js`：修改接口地址、动态提示语、卡名显示和图表渲染逻辑。
- `worker/index.js`：修改对局汇总、双方统计、换牌统计和 CR 筛选逻辑；修改后需要重新部署 Worker。
- `card-names.json`：更新卡牌名称索引时替换该文件；卡牌数据源来自 Tracker 使用的 `SV_WB_Cards.csv`。
- `styles.css`：修改颜色、间距、表格和图表布局。

日常发布流程：修改后运行 `node --check app.js` 与 `node --check worker/index.js`，在 `worker/` 目录运行 `npx wrangler deploy`，然后提交并推送仓库的 `main` 分支。GitHub Pages 会自动构建；Cloudflare R2 中的历史数据不需要随网页仓库提交。

建议的后期维护包括：定期更新卡牌名称索引和卡图资源、关注 Worker 与 Pages 的部署状态、检查 R2 存储/请求用量、定期备份 R2 数据，以及在统计口径调整后用少量测试记录核对胜负、对手反向统计和换牌数据。
