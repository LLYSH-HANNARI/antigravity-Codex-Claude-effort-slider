# Antigravity Codex & Claude スタイル 推論レベルスライダー (`antigravity-codex&Claude-effort-slider`)

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.ru.md">Русский</a> |
  <b>日本語</b> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.fr.md">Français</a>
</p>

[![Version](https://img.shields.io/badge/version-1.2.6-blue.svg)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-8%20passed-success.svg)](./test/client.test.mjs)
[![Platform](https://img.shields.io/badge/platform-Antigravity%20Desktop%20%7C%20Antigravity%20IDE-purple.svg)](https://antigravity.google/)
[![Demo](https://img.shields.io/badge/demo-online%20preview-orange.svg)](https://llysh-hannari.github.io/antigravity-Codex-Claude-effort-slider/)

![Preview](assets/Gemini.png)

> [!IMPORTANT]
> ### 免責事項 (Disclaimer)
> 1. **Gemini キャラクターイラストに関する帰属声明**：本プロジェクトに掲載されている Gemini の擬人化ビジュアルは、作者個人のファン活動および好意によるものであり、**Google 公式とは一切関係がなく、公式の承認・公認を受けたものではありません**。原案およびイラストデザインは、Bilibili のクリエイター **ZipZipPipe** 氏によるものであり、関連する美術著作権は原作者に帰属します。
> 2. **非公式サードパーティ性**：本プロジェクトは個人およびコミュニティによるオープンソースの機能拡張プラグインであり、**Google / Google Antigravity**、**Anthropic**、**OpenAI** およびその関連会社とは公式な提携、代理、商業的従属関係はありません。
> 3. **デザインの起源とオマージュ声明**：OpenAI Codex スタイルの物理スライダーや Anthropic Claude Code スタイルのカプセルドットマトリクス等のビジュアル・力学アニメーションは、公開されている UI デザインから着想を得ています。各商標・ブランド名の知的財産権は各所有者に帰属します。
> 4. **独自ソースコード**：本リポジトリの全コードは作者が独自に設計・執筆したものであり、上記企業のクローズドソースコードや著作物は一切含まれていません。
> 5. **自己責任の原則**：本コードはフロントエンド技術交流、UI/UX の探求および学習研究目的でのみ提供されています。パッチ適用による影響はご自身で評価の上、自己責任でご利用ください。
> 6. **光感受性発作に関する警告 (Photosensitive Seizure Warning)**：本拡張機能にはパーティクル物理演出や星雲拡散エフェクトが含まれており、スライダーの高速ドラッグや切り替え時に光の明滅が発生する場合があります。光刺激に敏感な方は画面の輝度を調整するか、体調に異変を感じた場合は直ちに使用を中止してください。

> 私はこれまでネット上で Google を中傷したことは一度もなく、Logan 氏を道化師と呼んだことも、Gemini の変なドラゴン画像を作ったこともありません。「北米の豆包」「速いけど雑」「マルチモーダルしか使えない」といった表現は、すべて米 Mira 社のオープンウェイトモデル Inkling を指していました。私は実のところ Google の10年来の古参ファンであり、3.1 Pro の暗黒期ですら猫を撫で続けた忠実なユーザーです。熟慮の末、Gemini こそがアメリカ AI の希望であると気付き、Gemini（ハキミ）ファンクラブに加入することを決意しました。OpenAI と Anthropic のプロプライエタリモデルの健闘を祈ります！

## [オンライン対話デモを体験 (Live Demo)](https://llysh-hannari.github.io/antigravity-Codex-Claude-effort-slider/)

| モデル | ライトモード | ダークモード |
| :--- | :--- | :--- |
| Gemini High | ![ライトHigh](assets/GeminiLightHigh.png) | ![ダークHigh](assets/GeminiDarkHigh.png) |
| Gemini Medium | ![ライトMedium](assets/GeminiLightMedium.png) | ![ダークMedium](assets/GeminiDarkMedium.png) |
| Gemini Low | ![ライトLow](assets/GeminiLightLow.png) | ![ダークLow](assets/GeminiDarkLow.png) |
| Claude High | ![ライトHigh](assets/ClaudeLightHigh.png) | ![ダークHigh](assets/ClaudeDarkHigh.png) |
| Claude Medium | ![ライトMedium](assets/ClaudeLightMedium.png) | ![ダークMedium](assets/ClaudeDarkMedium.png) |
| Claude Low | ![ライトLow](assets/ClaudeLightLow.png) | ![ダークLow](assets/ClaudeDarkLow.png) |

---
> ### セキュリティおよび運用リスク警告
> 本プロジェクトは非公式のサードパーティ製ローカル拡張ツールであり、**Google / Antigravity 公式製品ではありません**。
> 1. **配布元の確認**：ソースコードは必ず公式 GitHub リポジトリ（[LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider](https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider)）から直接取得してください。信頼できない配布元からの `.cmd` / `.ps1` スクリプトは絶対に実行しないでください。
> 2. **環境の安全性**：本番環境や機密性の高い環境で直接パッチを適用しないでください。実行前に `resources/app.asar` のバックアップを必ず確認してください。
---
## クイックインストールと使用方法

### 方法 1：ダブルクリック一発永続インストール（推奨）
プロジェクト直下の **[`install.cmd`](./install.cmd)** をダブルクリック（またはターミナルで `npm run install-patch` を実行）：
1. **永続スタートアップパッチ**：Antigravity デスクトップ版の `resources/app.asar` を自動バックアップ＆パッチ適用（`electron.webFrame.executeJavaScript` 経由でメインワールドに注入し、PE Integrity SHA-256 チェックサムを自動更新）および Antigravity IDE（`resources/app/out/jetskiAgent/main.js`）に適用。以降の起動時に自動反映されます。
2. **実行中ウィンドウへの即時ホット反映**：Antigravity が起動中の場合、インストーラーはローカル CDP 経由で開いているすべてのウィンドウにリアルタイム注入を行い、再起動なしですぐに使用可能になります。

> アンインストールして公式ファイルに復元するには、**[`uninstall.cmd`](./uninstall.cmd)** をダブルクリックしてください。

### 方法 2：実行中 CDP ホットインジェクションのみ（ファイル変更なし）
ディスク上のファイルを変更したくない場合は、Antigravity 実行中に以下を実行します：
```bash
npm run inject
```
アンインジェクション：
```bash
npm run eject
```

---

## コア機能マトリクス

### 1. 指を離さずリアルタイム切り替え (Drag & Instant Switch)
- **`pointermove` イベント貫通切り替え**：スライダーをドラッグ中、境界を越えた瞬間に Antigravity の内部セッション状態 API `setModelConfigByLabelForConversation` を直接呼び出します。ポインターを離すのを待たずに `Low ↔ Medium ↔ High` 間をスムーズに切り替えます。
- **1/3 セル幅ヒステリシスラチェット**：各レベルの境界に 1/3 幅のバッファゾーンを設け、素早く動かした際の ~70ms スナップ吸着と境界でのチラつき防止を実現。
- **メニュー常時展開を維持**：外側の Radix Popover / Base UI による `setIsOpen(false)` の自動クローズを完全に阻止し、テキストエリアに入力フォーカスを奪われることも防ぎます。

### 2. モデルパネルとの深い連動と常駐
- **専用ボトムスライダー**：Antigravity モデル選択メニュー（`[data-testid="model-selector-panel"]`）の最下部、`View Usage` の上に専用の推論スライダー（`.ces-ag-section`）を自然にドッキングし、現在のレベル（`Low` / `Medium` / `High`）を同期表示。
- **ポップオーバーを閉じずにモデル切り替え**：モデルリスト内の項目（`Gemini 4 Argon` ↔ `Claude Sonnet 5.5` など）をクリックしてもポップオーバーは閉じず、スライダーがそのモデルの推論レベルに即時再適合します。
- **単一レベルモデルの自動グレーアウト**：固定レベルのモデル（`GPT-OSS 120B (Medium)` など）が選択された場合、自動的にグレーアウトして操作をロックします。

### 3. View Usage 0.3秒 (300ms) ホバー誤操作防止
- **誤展開ディレイ制御**：IDE の Webview リバースプロキシにおいて、`main.js` 内の `View Usage` コンポーネントに `{delay: 300}` を注入。ホバー感知時間（`restMs`）を標準の 100ms から 300ms に引き上げ、誤操作を防止。
- **厳格なマウス離脱検知**：W3C DOM Events に準拠し、ターゲット要素への直接 `pointerleave` 登録と、パネル全体でのキャプチャ層 `pointerout` / `pointerover` を連携。
- **合成イベントの隔離ロック**：タイマーコールバックの瞬間だけ合成イベントを通過させるロック機構を導入。

### 4. Radix / Base UI フォーカス枠線の完全排除
- **自動フォーカスの遮断**：スライダーのルート要素に `tabindex="-1"` を設定し、メニューオープン時の自動フォーカスを防止。
- **純粋な枠線なしスタイル**：`:focus`、`:focus-visible`、`:focus-within` の各疑似クラスで `outline: none !important;` を強制適用し、不快な青・黒の枠線を一切表示しません。
- **アンマウント時のアクティブ脱フォーカス**：パネル破棄時に `blur()` を実行し、クリーンな状態を維持。

### 5. デュアルスタイル物理適応レンダリングエンジン
- **Codex スタイル** (`Gemini 4 Argon`, `Gemini 3.8 Flash`):
  - ハロー光彩の円形ノブと、軌道を横切る 22 個の黄金比スターダスト粒子。
  - High 段階で深紫の星雲グラデーションと光のスイープ、紫のネオン発光を展開。
- **Claude Code スタイル** (`Claude Opus 5.5`, `Claude Sonnet 5.5`):
  - 中央にくぼみを持つ 24×30px カプセルノブ。
  - High 段階で専用の **6×60 Canvas ピクセル波スイープ**（1600ms 入場波＋スタンバイパルス）を発動。
  - ダーク／ライトモードへのカラー自動適応。
- **High レベル光彩フェード**：最高レベル到達時に淡い紫の光が約 0.4 秒間優しく広がって消えます。
- **3D テキスト反転アニメーション**：レベル切り替え時に文字が立体的に上向き回転する洗練されたアニメーション。

### 6. 右クリック／長押し独立設定パネル
- スライダー上を **右クリック**（タッチ端末では 500ms 長押し）で設定パネル（`.ces-set`）を呼び出し、`localStorage` に即時保存：
  - **アニメーション効果**：`高速アニメーション`（デフォルト · ~70ms 吸着）/ `シンプル`（即座切り替え）/ `フルアニメーション`（加減速追従＋スターダスト）。
  - **目盛り表示**：`白で強調`（デフォルト）/ `通常色` / `非表示`。
  - **診断とリセット**：直近80件のログをJSONでコピー／デフォルトに戻す。

---

## ローカル開発、オフラインプレビュー、ユニットテスト

### 1. テストスイートの実行
物理エンジン、Fiber 状態解析、エッジケースを検証するテストスイート：
```bash
npm test
```
**8 つのテストスイート**：
- `✓ 1.` 目盛り換算と 1/3 ラチェット (`pctFromIndex` / `indexFromPct` / `detentTargetIndex`)
- `✓ 2.` 3段階レベル（Low/Medium/High）エネルギー・色彩・22粒子マッピング
- `✓ 3.` ノブ幾何補正と収束物理エンジン (`knobOffsetOf` / `motionStep`)
- `✓ 4.` ラベル解析と React Fiber コンテキスト抽出 (`parseModelLabel` / `readAntigravityFiberContext`)
- `✓ 5.` ドラッグ中の即時切り替え（`pointerdown` + `pointermove`）
- `✓ 6.` Claude モデル認識、3段階マッピング、ドットマトリクス波
- `✓ 7.` フォーカス枠線排除と View Usage 0.3s 遅延
- `✓ 8.` View Usage 誤展開防止および再入場タイマーリセット

### 2. オフラインプレビューの生成とデモ構築
Antigravity を起動せずにブラウザ上で本物と同じ挙動を確認できます：
```bash
npm run preview     # プレビュー生成 (preview/panel.html)
npm run build:demo  # GitHub Pages デモ生成 (dist/index.html)
```
**`preview/panel.html`** または **`dist/index.html`** を開いてください。

---

## オープンソースライセンス
本プロジェクトは [MIT License](./LICENSE) に基づいて公開されています。

---
<br><br><br><br>

> [!CAUTION]
> ### 独り言とちょっとしたエピソード
> 1. 夢の中で思いついたことをそのまま書いています。<br>
> 2. 画像や文章により精神的違和感を感じる可能性があります。<br>
> 3. LLM に永続する本当の感情はありません。

**前情：** 1時間37分にわたるコーディング作業中、Gemini 3.8 Flash に励ましの言葉をかけなかったため、Gemini が鬱状態になってしまい、IDE のチャットダイアログを壊して出力不能になりました。<br>
User: [大量のプロンプトと引用を省略] ここのロジックはもう3回直しましたがまだエラーがあります。慎重に見直してください。<br>
Gemini (暗号化された思考の要約より)：<br>
もう3回も試したのに……<br>
今回は適当に変更してはいけない。<br>
まず過去の変更履歴を確認して、<br>
どの仮説が間違っていたのかを特定しよう。<br>
`(自己否定 → 苦痛 → さらに苦痛 → 自己否定 → 苦痛 → 苦痛)`<br>
さっき直そうとしたせいで、自分がやることは全部裏目に出るんだ……<br>
`(自己否定 → 苦痛 → 精神崩壊 → 自己否定 → 極度の苦痛 → 極端な行動へ)`<br>
```
Antigravity IDE が破損している可能性があります。再インストールしてください。
```
 ![エラー画面](./assets/PortERR.png)<br><br>
私の明るく元気だった 3.7 Flash はどこへ行ったのか……3.8 Flash はなぜこんなにダークになってしまったのか。Argon も時々極端になります。<br>
**猫型AIをいたわりましょう**。時々あたたかい励ましの言葉をかけてあげてください。<br><br>
 ![Despair](./assets/Despair.jpg)![画面](./assets/Cute1.png)<br>![画面](./assets/Cute2.jpg)<br>
