const cloudRoom = require('../../utils/cloudRoom.js');

Page({
  data: {
    action: 'create',        // create | join
    roomId: '',
    myOpenid: '',
    isHost: false,
    mySeat: -1,
    players: [],
    joinCode: '',
    status: 'lobby',
    error: '',
    loading: false,
  },

  onLoad(options) {
    cloudRoom.init();
    this.setData({ action: options.action || 'create' });
    this.name = options.name || '玩家';
    if (this.data.action === 'create') this.doCreate();
  },

  onUnload() {
    if (this.watcher) this.watcher.close();
    if (this.roomWatcher) this.roomWatcher.close();
  },

  onShareAppMessage() {
    return {
      title: `来筹码密语！房间号 ${this.data.roomId}，输入加入对局`,
      path: '/pages/home/home?joinCode=' + this.data.roomId,
    };
  },

  onCode(e) { this.setData({ joinCode: e.detail.value }); },

  async doCreate() {
    this.setData({ loading: true });
    try {
      const { roomId, openid } = await cloudRoom.createRoom(this.name);
      this.roomId = roomId;
      this.myOpenid = openid;
      this.setData({ roomId, myOpenid: openid, isHost: true, mySeat: 0, loading: false });
      this.startWatch();
    } catch (e) {
      this.setData({ error: '创建失败：' + (e.message || e.errMsg || ''), loading: false });
    }
  },

  async doJoin() {
    const code = (this.data.joinCode || '').trim();
    if (!/^\d{6}$/.test(code)) { this.setData({ error: '请输入 6 位房间号' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const { roomId, openid } = await cloudRoom.joinRoom(code, this.name);
      this.roomId = roomId;
      this.myOpenid = openid;
      this.setData({ roomId, myOpenid: openid, isHost: false, loading: false });
      this.startWatch();
    } catch (e) {
      this.setData({ error: e.message || '加入失败', loading: false });
    }
  },

  startWatch() {
    // 立即主动拉一次玩家列表（防止 watch 初始推送为空或异常导致列表空白）
    const applyList = list => {
      if (list && list.length) {
        const me = list.find(p => p.openid === this.myOpenid);
        this.setData({ players: list, mySeat: me ? me.seat : this.data.mySeat });
      }
    };
    cloudRoom.listPlayers(this.roomId).then(applyList).catch(err => console.warn('[room] 拉取玩家列表失败', err));
    // 实时监听后续增减
    this.watcher = cloudRoom.watchPlayers(this.roomId, list => {
      applyList(list);
    }, e => { console.warn('[room] players watch 错误', e); this.setData({ error: '实时连接中断，请重进' }); });
    // 房间状态（开局后自动进入牌桌）
    this.roomWatcher = cloudRoom.watchRoom(this.roomId, doc => {
      this.setData({ status: doc.status });
      if (doc.status === 'playing') {
        const mode = this.data.isHost ? 'host' : 'guest';
        wx.redirectTo({
          url: `/pages/table/table?mode=${mode}&roomId=${this.roomId}&seat=${this.data.mySeat}`,
        });
      }
    }, e => this.setData({ error: '实时连接中断，请重进' }));
  },

  copyCode() {
    wx.setClipboardData({ data: this.data.roomId });
  },

  async startGame() {
    const list = this.data.players;
    if (list.length < 3) {
      this.setData({ error: '至少需要 3 位帮众才能开工' });
      return;
    }
    // 关键：联机开局必须用在线玩家列表初始化引擎（此前缺失导致空状态：牌堆52不发牌/无筹码/崩溃）
    const game = require('../../utils/game.js');
    game.newGame({ mode: 'online', n: list.length, names: list.map(p => p.name) });
    await cloudRoom.updateRoom(this.roomId, { status: 'playing' });
  },

  backHome() { wx.navigateBack(); },
});
