export class NeedsAuthError extends Error {
  constructor() {
    super('駿河屋需要人工驗證：程式已開啟 Firefox 視窗，請點一次「私はロボットではありません」再重試。');
    this.name = 'NeedsAuthError';
  }
}
