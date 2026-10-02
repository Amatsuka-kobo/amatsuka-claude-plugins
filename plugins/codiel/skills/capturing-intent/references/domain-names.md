# 領域名の決定

持続層を読む前に、この intent が属する領域名を決める。この確認は run を作る前に行うので、`mark-ask` を使わない。

- intent の frontmatter に `domains` が既にあれば(intent パスを入口にした run、v1 からの昇格)、それを使い、聞き直さない。
- `projectDocs.domainsReadable` が `true` なら、ドメインマップのキーのうち、TOBE で変わるファイルが glob に当たるものを選ぶ。ユーザーには別に聞かず、手順 4 のドラフトの frontmatter で示して承認を得る。当たるキーが無ければ `domains` を空のままにし、ドラフトでその旨を示す。
- 読めなければ、TOBE と現状調査から領域名の候補を 2〜3 個作り、AskUserQuestion で聞く。候補は `intent-format.md` の正規化の後の形(英小文字のケバブケース)で示す。複数の領域を選べるようにし、候補の外の答えも受ける。
- 決めた領域名を intent の frontmatter `domains` に、1 行のフロー形式(`domains: [frontend, data]`)で書く。
