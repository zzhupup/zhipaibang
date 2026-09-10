const game = require('../../utils/game.js');

Page({
  data: {
    playMode: 'online',       // online | single
    mode: 'standard',
    n: 3,
    names: ['', '', ''],
    nick: '',
    joinCode: '',
    showRules: false,
    rulesHtml: '',
  },

  onLoad(options) {
    this.setData({ rulesHtml: this.rulesHtml() });
    // 静默清扫：释放"房内已无活跃玩家"的死房间（未开通云开发时静默忽略，不影响首页）
    try { require('../../utils/cloudRoom.js').sweepRooms(); } catch (e) { /* noop */ }
    // 分享卡片直达加入房间
    if (options && options.joinCode) {
      this.setData({ playMode: 'online', joinCode: options.joinCode });
      wx.navigateTo({ url: '/pages/room/room?action=join&name=玩家&joinCode=' + options.joinCode });
    }
  },

  onShareAppMessage() {
    return {
      title: '筹码密语 · 无言的配合，完美的劫案！3~6 人在线或同屏',
      path: '/pages/home/home',
    };
  },
  onShareTimeline() {
    return { title: '筹码密语 · 合作扑克劫案' };
  },

  pickPlay(e) { this.setData({ playMode: e.currentTarget.dataset.v }); },
  pickMode(e) { this.setData({ mode: e.currentTarget.dataset.v }); },
  pickCount(e) {
    const n = +e.currentTarget.dataset.v;
    const names = this.data.names.slice(0, n);
    while (names.length < n) names.push('');
    this.setData({ n, names });
  },
  onName(e) {
    const i = e.currentTarget.dataset.i;
    const names = this.data.names.slice();
    names[i] = e.detail.value;
    this.setData({ names });
  },
  onNick(e) { this.setData({ nick: e.detail.value }); },
  onJoinCode(e) { this.setData({ joinCode: e.detail.value }); },
  openRules() { this.setData({ showRules: true }); },
  closeRules() { this.setData({ showRules: false }); },

  start() {
    const { mode, n, names } = this.data;
    const finalNames = names.map((v, i) => (v.trim() || '玩家' + (i + 1)));
    game.newGame({ mode, n, names: finalNames });
    wx.navigateTo({ url: '/pages/table/table?mode=single' });
  },

  goRoom(e) {
    const action = e.currentTarget.dataset.v;
    const nick = (this.data.nick || '').trim() || (action === 'create' ? '房主' : '玩家');
    // 加入：跳转 room 页输入房间号（room 页自带 6 位房号输入界面）
    let url = `/pages/room/room?action=${action}&name=${encodeURIComponent(nick)}`;
    if (action === 'join' && this.data.joinCode) url += '&joinCode=' + this.data.joinCode;
    wx.navigateTo({ url });
  },

  rulesHtml() {
    const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺', '皇家同花顺'];
    const DESC = ['五张不组成任何牌型，比最大单张', '两张同数值', '两对，先比大对再比小对', '三张同数值', '五张连续数值（A 可作 1 或最大，不能在中间）', '五张同花色', '三条 + 一对', '四张同数值', '同花 + 顺子', '同花 10-J-Q-K-A'];
    let rows = '';
    for (let i = 0; i < 10; i++) {
      rows += `<div style="display:flex;border-bottom:2rpx solid rgba(46,122,88,.4);padding:10rpx 4rpx;font-size:25rpx"><div style="width:200rpx;color:#e8c15a;flex:none">${HAND_NAMES[i]}</div><div style="flex:1;color:#cfe8da">${DESC[i]}</div></div>`;
    }
    return `<div style="line-height:1.9;font-size:26rpx;color:#e3f0e8">
      <b style="color:#e8c15a">一句话概括</b><br><br>
      一局由 3~5 次"行动"组成，每次行动分四个阶段：发底牌拿白筹码 → 翻三张公共牌拿黄筹码 → 再翻一张拿橙筹码 → 再翻一张拿红筹码。<br><br>
      每个阶段人人手里都要有一枚该阶段颜色的筹码，<b style="color:#e8c15a">星星越多 = 你预估自己的牌越强</b>。筹码可以自己从桌面拿、可以从同伴手里夺、也可以把不要的丢回桌面，但同一种颜色每人面前只能放一枚。全员各自点"确认"后才进入下一阶段；确认前筹码随便换，变动过就要重新确认。<br><br>
      <b style="color:#e8c15a">最后亮牌</b>：按红筹码星星由少到多依次亮牌，后亮的人牌型不能比前一位弱（一样强也算过）。全程都对 → 金库加一分；只要有一人更弱 → 警报加一分。金库攒满 3 分获胜，警报攒满 3 分失败。<br><br>
      <b style="color:#e8c15a">铁律</b>：不能说话、不能打手势、不能有任何暗示——筹码是你唯一的"暗号"！<br><br>
      <b style="color:#e8c15a">牌型强弱（从低到高）</b>
      <div style="margin-top:10rpx">${rows}</div>
    </div>`;
  },
});
