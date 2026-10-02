## 観点

- 観点は design.md・spec.md・実装の相互整合、ARCHITECTURE との乖離、ドキュメント更新漏れ である。
- design.md が定めた設計と実装が一致することを確認する。
- この観点の未達は design.md にある方針・機能単位が実装に反映されていないこと、逸脱は design.md にない設計判断が実装に混入していることである。
- spec.md / cases.md の記述と実装の振る舞いが食い違わないことを確認する。
- ARCHITECTURE のドメインマップと実装の乖離を確認する。
- 乖離は所見(severity は low か medium)として返す。
- 依頼文の ARCHITECTURE が「なし」のときは、ARCHITECTURE との乖離の確認を飛ばす。
- README、API ドキュメントなど、今回の変更で更新すべきドキュメントの更新漏れを確認する。
- design.md が discussion.md の「状態: 決定」の論点と整合することを確認する。
- 合意が黙って覆されているときは severity: high で指摘する。
