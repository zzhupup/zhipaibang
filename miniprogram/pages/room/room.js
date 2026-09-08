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
      title: `来无声劫案！房间号 ${this.data.roomId}，输入加入对局`,
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
    // 玩家列表
    this.watcher = cloudRoom.watchPlayers(this.roomId, list => {
      const me = list.find(p => p.openid === this.myOpenid);
      this.setData({ players: list, mySeat: me ? me.seat : -1 });
    }, e => this.setData({ error: '实时连接中断，请重进' }));
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
    if (this.data.players.length < 3) {
      this.setData({ error: '至少需要 3 位帮众才能开工' });
      return;
    }
    await cloudRoom.updateRoom(this.roomId, { status: 'playing' });
  },

  backHome() { wx.navigateBack(); },
});
