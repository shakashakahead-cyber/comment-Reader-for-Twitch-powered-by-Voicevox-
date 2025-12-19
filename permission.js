// permission.js
document.getElementById('btnAllow').addEventListener('click', async () => {
  try {
    // マイク権限を要求
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // 成功したらすぐにストリームを停止
    stream.getTracks().forEach(track => track.stop());
    
    alert("成功しました！このタブを閉じて、拡張機能のアイコンから設定を開き直してください。");
    window.close();
    
  } catch (err) {
    console.error(err);
    alert("許可されませんでした。\nブラウザのアドレスバー左側の「設定アイコン」からマイクを許可してください。");
  }
});