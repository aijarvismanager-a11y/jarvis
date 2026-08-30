param([Parameter(Mandatory=$true)][string]$Key)

$messages = @{
  shortcut_creating   = "デスクトップにショートカットを作成しています..."
  node_missing        = "Node.js が見つかりません。インストールします（少し時間がかかります）..."
  winget_unavailable  = "winget が使えないため、公式インストーラーを直接ダウンロードします..."
  download_failed     = "ダウンロードに失敗しました。手動で https://nodejs.org からインストールしてから、もう一度アイコンをダブルクリックしてください。"
  installing_confirm  = "インストール中です。確認画面が出た場合は「はい」を選んでください..."
  node_verify_failed  = "Node.js のインストールを確認できませんでした。このウィンドウを閉じてPCを再起動し、もう一度アイコンをダブルクリックしてください。"
  node_installed      = "Node.js のインストールが完了しました。"
  npm_installing      = "依存パッケージをインストールしています（初回のみ、数分かかります）..."
  npm_install_failed  = "インストールに失敗しました。インターネット接続を確認してから、もう一度アイコンをダブルクリックしてください。"
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host $messages[$Key]
