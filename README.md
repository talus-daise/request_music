# リクエスト曲投稿サイト (Cloudflare Pages + Functions + D1)

## ディレクトリ構成

- `public/request.html`: 投稿ページ
- `public/player.html`: 再生ページ
- `public/assets/*`: フロントエンドJS/CSS
- `functions/api/*`: Pages Functions API
- `functions/lib/*`: 共通ユーティリティ
- `migrations/0001_init.sql`: 初期D1スキーマ
- `wrangler.toml`: Cloudflare設定

## セットアップ

```bash
npm install
```

1. CloudflareでD1作成
```bash
wrangler d1 create request_music
```
2. 出力された `database_id` を `wrangler.toml` に反映
3. マイグレーション
```bash
npm run db:migrate
npm run db:migrate:playback
```

### ローカル開発
```bash
npm run db:migrate:local
npm run db:migrate:playback:local
npm run dev
```

- 投稿ページ: `http://localhost:8788/request.html`
- 再生ページ: `http://localhost:8788/player.html`

## API

- `POST /api/request`: 投稿
- `GET /api/requests?unplayedOnly=1`: 投稿一覧 + 統計
- `GET /api/random-song`: 重み付きランダム選曲
- `GET /api/playback-state`: 全デバイス共通の現在再生状態
- `POST /api/playback-next`: 現在曲を再生済みにして次曲を全デバイスへ配信
- `POST /api/playback-duration`: YouTubeから取得した曲の長さを共有状態へ反映（最大5分）
- `POST /api/playback-heartbeat`: 再生中デバイスの生存通知
- `POST /api/playback-leave`: 再生をやめたデバイスの離脱通知
- `POST /api/song-played`: 再生済み更新
- `GET /api/history`: 再生履歴
- `POST /api/admin-reset`: 管理用リセット (`x-admin-key` 必須)

## 再生ページの同期設計

再生ページはD1の `playback_state` を共有状態として使います。
どれかのデバイスで再生開始または「次へ進む」が実行されると、サーバー側の現在曲・開始時刻・残り時間が更新され、他のデバイスは `GET /api/playback-state` の定期取得で同じ曲と再生位置に追従します。再生中の各デバイスはheartbeatを送り、全デバイスが離脱または一定時間heartbeat未送信になると共有再生状態は停止します。

## Weighted Random の設計

`GET /api/random-song` は未再生曲から候補を取り、次の重みを掛け合わせて抽選します。

- `base = 1 / 投稿者の総投稿数`
- `todayFactor = 1 / (1 + 今日の再生回数 * 1.2)`
- `recentFactor = max(0.15, 1 - 直近履歴ペナルティ * 0.35)`
- `replayFactor = 1 / (1 + play_count * 0.5)`

`weight = base * todayFactor * recentFactor * replayFactor`

これにより、投稿が少ない人・今日まだ流れていない人・直近で流れていない人の曲が優先されます。

## セキュリティ実装

- 入力値のサニタイズ
- YouTube URL形式検証 + 動画ID抽出保存
- D1 prepared statementでSQLインジェクション対策
- CSP / `X-Content-Type-Options` / `X-Frame-Options` 付与
- 簡易レート制限（同一学籍番号 or IP を30秒制限）

## デプロイ

```bash
npm run deploy
```

Cloudflare Pages プロジェクトを本リポジトリに接続し、Functions + D1 binding を有効にしてください。
